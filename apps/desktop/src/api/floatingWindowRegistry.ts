import { logger } from "@/lib/logger";
import { isTauri } from "@/api/tauri";
import { trixtyStore } from "@/api/store";

export type DetachablePanel = "right" | "left" | "bottom";

/** Special viewId reserved for the (single) detachable BottomPanel. The
 *  shell renders a placeholder when this ID is detached, and the
 *  floating page recognises it to render `<BottomPanel />` directly
 *  instead of going through the regular view registry. */
export const BOTTOM_PANEL_VIEW_ID = "trixty.builtin.bottom-panel";

export interface DetachedBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetachedEntry {
  windowLabel: string;
  panel: DetachablePanel;
  bounds?: DetachedBounds;
}

const PERSIST_STORE_KEY = "trixty.floating.detached";
const PERSIST_DEBOUNCE_MS = 300;

interface PersistedDetachedEntry {
  viewId: string;
  windowLabel: string;
  panel: DetachablePanel;
  bounds?: DetachedBounds;
}

export interface FloatingWindowRegistryAPI {
  detach(
    viewId: string,
    panel: DetachablePanel,
    spawnHint?: { x: number; y: number; title?: string },
  ): Promise<void>;
  redock(viewId: string): Promise<void>;
  isDetached(viewId: string): boolean;
  getEntry(viewId: string): DetachedEntry | undefined;
  list(): Array<{ viewId: string; entry: DetachedEntry }>;
  subscribe(listener: () => void): () => void;
  focus(viewId: string): Promise<void>;
  /**
   * Restore detached views from the persistent store and respawn their
   * floating windows. Call once during app boot from the main window only —
   * auxiliary windows must NOT call this or they will spawn duplicate
   * windows for every previously-detached view.
   */
  hydrateFromStore(): Promise<void>;
  /**
   * Test-only reset hook. Clears state without touching Tauri windows.
   * Production code must NEVER call this.
   */
  __resetForTests(): void;
}

const FLOAT_WINDOW_DEFAULT_SIZE = { width: 480, height: 640 };
const FLOAT_WINDOW_MIN_SIZE = { minWidth: 320, minHeight: 280 };

// Tauri 2 only allows `a-zA-Z0-9-/:_` in window labels (see
// `@tauri-apps/api/webviewWindow.js`). View IDs like
// `trixty.builtin.ai-assistant` contain `.`, which fails IPC validation and
// surfaces only via `tauri://error` — by then the slot has already swapped to
// the placeholder, leaving the user stuck. Sanitize once, here.
const TAURI_LABEL_INVALID = /[^a-zA-Z0-9\-/:_]/g;

/**
 * Tauri 2 only allows `a-zA-Z0-9-/:_` in window labels. View IDs like
 * `trixty.builtin.ai-assistant` contain `.` which would fail IPC
 * validation. We sanitize by replacing every invalid char with `_` and
 * append a 4-char hex digest of the original viewId so two distinct
 * IDs that collapse to the same sanitized form (e.g. `a.b` vs `a:b`)
 * still produce distinct labels.
 */
function buildWindowLabel(viewId: string): string {
  const sanitized = viewId.replace(TAURI_LABEL_INVALID, "_");
  // Tiny FNV-1a (32-bit) — no crypto strength needed, just a stable
  // disambiguator. 4 hex chars = ~65k buckets, plenty for "two views
  // sanitize to the same string" cases.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < viewId.length; i++) {
    h ^= viewId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const hash = h.toString(16).padStart(8, "0").slice(0, 4);
  return `floating-${sanitized}-${hash}`;
}

class FloatingWindowRegistry implements FloatingWindowRegistryAPI {
  private detached = new Map<string, DetachedEntry>();
  private listeners = new Set<() => void>();
  private bridgeReady = false;
  private hydrated = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  async detach(
    viewId: string,
    panel: DetachablePanel,
    spawnHint?: { x: number; y: number; title?: string },
  ): Promise<void> {
    await this.ensureBridge();

    const existing = this.detached.get(viewId);
    if (existing) {
      logger.debug(`[floating] detach(${viewId}) idempotent — focusing existing window`);
      await this.focusWindow(existing.windowLabel);
      return;
    }

    const windowLabel = buildWindowLabel(viewId);
    const bounds = spawnHint
      ? {
          x: spawnHint.x,
          y: spawnHint.y,
          w: FLOAT_WINDOW_DEFAULT_SIZE.width,
          h: FLOAT_WINDOW_DEFAULT_SIZE.height,
        }
      : undefined;
    this.detached.set(viewId, { windowLabel, panel, bounds });
    this.notify();
    this.schedulePersist();

    await this.spawnWindow(viewId, windowLabel, spawnHint);
  }

  async redock(viewId: string): Promise<void> {
    const entry = this.detached.get(viewId);
    if (!entry) return;
    this.detached.delete(viewId);
    this.notify();
    this.schedulePersist();
    await this.closeWindow(entry.windowLabel);
  }

  isDetached(viewId: string): boolean {
    return this.detached.has(viewId);
  }

  getEntry(viewId: string): DetachedEntry | undefined {
    return this.detached.get(viewId);
  }

  list(): Array<{ viewId: string; entry: DetachedEntry }> {
    return Array.from(this.detached.entries(), ([viewId, entry]) => ({ viewId, entry }));
  }

  // Arrow class field so `this` stays bound when the method is passed by
  // reference (e.g. `useSyncExternalStore(registry.subscribe, ...)`).
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async focus(viewId: string): Promise<void> {
    const entry = this.detached.get(viewId);
    if (!entry) return;
    await this.focusWindow(entry.windowLabel);
  }

  __resetForTests(): void {
    this.detached.clear();
    this.listeners.clear();
    this.bridgeReady = false;
    this.hydrated = false;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
  }

  async hydrateFromStore(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!isTauri()) return;
    let entries: PersistedDetachedEntry[] = [];
    try {
      entries = await trixtyStore.get<PersistedDetachedEntry[]>(
        PERSIST_STORE_KEY,
        [],
      );
    } catch (err) {
      logger.warn("[floating] hydrate read failed:", err);
      return;
    }
    if (!Array.isArray(entries) || entries.length === 0) return;

    await this.ensureBridge();

    for (const e of entries) {
      if (!e || typeof e.viewId !== "string") continue;
      // Repopulate the in-memory map BEFORE spawning so the slot's first
      // render already shows the placeholder.
      this.detached.set(e.viewId, {
        windowLabel: e.windowLabel,
        panel: e.panel,
        bounds: e.bounds,
      });
      const spawnHint = e.bounds
        ? { x: e.bounds.x, y: e.bounds.y, w: e.bounds.w, h: e.bounds.h }
        : undefined;
      // Fire-and-forget: spawn errors will roll back the entry on the
      // tauri://error path inside spawnWindow.
      void this.spawnWindow(e.viewId, e.windowLabel, spawnHint);
    }
    this.notify();
  }

  /** Update the cached bounds for a view based on a moved/resized event. */
  private updateBounds(viewId: string, bounds: DetachedBounds): void {
    const entry = this.detached.get(viewId);
    if (!entry) return;
    entry.bounds = bounds;
    this.schedulePersist();
  }

  private schedulePersist(): void {
    if (!isTauri()) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  private async persistNow(): Promise<void> {
    // Cancel any pending debounced write so a queued snapshot from
    // before the immediate write does not clobber the freshest state.
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const payload: PersistedDetachedEntry[] = Array.from(
      this.detached.entries(),
      ([viewId, entry]) => ({
        viewId,
        windowLabel: entry.windowLabel,
        panel: entry.panel,
        bounds: entry.bounds,
      }),
    );
    try {
      await trixtyStore.set(PERSIST_STORE_KEY, payload);
    } catch (err) {
      logger.warn("[floating] persist write failed:", err);
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private async ensureBridge(): Promise<void> {
    if (this.bridgeReady || !isTauri()) {
      this.bridgeReady = true;
      return;
    }
    try {
      const { listen } = await import("@tauri-apps/api/event");

      // Float-side close (X) → main re-docks state without re-closing.
      await listen<{ viewId: string }>("floating-window:closed", (event) => {
        const viewId = event.payload?.viewId;
        if (typeof viewId !== "string") return;
        if (!this.detached.has(viewId)) return;
        this.detached.delete(viewId);
        this.notify();
        this.schedulePersist();
      });

      // Float-side "Dock back" button → close window + clean up state.
      await listen<{ viewId: string }>("floating-window:redock-request", (event) => {
        const viewId = event.payload?.viewId;
        if (typeof viewId !== "string") return;
        void this.redock(viewId);
      });

      // Track bounds so a restart respawns each window where the user left it.
      await listen<{ viewId: string; x: number; y: number; w: number; h: number }>(
        "floating-window:moved",
        (event) => {
          const p = event.payload;
          if (!p || typeof p.viewId !== "string") return;
          if (
            typeof p.x !== "number" ||
            typeof p.y !== "number" ||
            typeof p.w !== "number" ||
            typeof p.h !== "number"
          )
            return;
          this.updateBounds(p.viewId, { x: p.x, y: p.y, w: p.w, h: p.h });
        },
      );

      this.bridgeReady = true;
    } catch (err) {
      logger.warn("[floating] event bridge init failed:", err);
      this.bridgeReady = true;
    }
  }

  private async spawnWindow(
    viewId: string,
    windowLabel: string,
    spawnHint?: { x: number; y: number; title?: string; w?: number; h?: number },
  ): Promise<void> {
    if (!isTauri()) return;
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const url = `/floating?view=${encodeURIComponent(viewId)}`;
      const win = new WebviewWindow(windowLabel, {
        url,
        title: spawnHint?.title ?? "Trixty IDE",
        width: spawnHint?.w ?? FLOAT_WINDOW_DEFAULT_SIZE.width,
        height: spawnHint?.h ?? FLOAT_WINDOW_DEFAULT_SIZE.height,
        ...FLOAT_WINDOW_MIN_SIZE,
        decorations: false,
        transparent: false,
        center: !spawnHint,
        x: spawnHint?.x,
        y: spawnHint?.y,
      });
      win.once("tauri://error", (err) => {
        logger.warn(`[floating] WebviewWindow ${windowLabel} reported error:`, err);
        // The constructor returns synchronously but the OS-level window
        // creation is async on the Rust side. If it fails (e.g. invalid label,
        // missing capability), roll back so the slot re-renders the actual
        // view instead of stranding the user on the "in floating window"
        // placeholder.
        const current = this.detached.get(viewId);
        if (current && current.windowLabel === windowLabel) {
          this.detached.delete(viewId);
          this.notify();
          // Persist immediately rather than via the debounce — the
          // debounce window can race with the optimistic write that
          // queued when `detach()` ran, leaving a stale entry on disk
          // for a window that never came up.
          void this.persistNow();
        }
      });
    } catch (err) {
      logger.error(`[floating] failed to spawn ${windowLabel}:`, err);
      // Roll back the registry entry so the slot does not show the placeholder
      // for a window that never came up.
      this.detached.delete(viewId);
      this.notify();
      void this.persistNow();
    }
  }

  private async closeWindow(windowLabel: string): Promise<void> {
    if (!isTauri()) return;
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const win = await WebviewWindow.getByLabel(windowLabel);
      if (win) await win.close();
    } catch (err) {
      logger.warn(`[floating] close ${windowLabel} failed:`, err);
    }
  }

  private async focusWindow(windowLabel: string): Promise<void> {
    if (!isTauri()) return;
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const win = await WebviewWindow.getByLabel(windowLabel);
      if (win) await win.setFocus();
    } catch (err) {
      logger.warn(`[floating] focus ${windowLabel} failed:`, err);
    }
  }
}

export const floatingWindowRegistry: FloatingWindowRegistryAPI = new FloatingWindowRegistry();
