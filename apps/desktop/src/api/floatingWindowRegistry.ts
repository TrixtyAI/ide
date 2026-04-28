import { logger } from "@/lib/logger";
import { isTauri } from "@/api/tauri";

export type DetachablePanel = "right";

export interface DetachedEntry {
  windowLabel: string;
  panel: DetachablePanel;
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
   * Test-only reset hook. Clears state without touching Tauri windows.
   * Production code must NEVER call this.
   */
  __resetForTests(): void;
}

const FLOAT_WINDOW_DEFAULT_SIZE = { width: 480, height: 640 };
const FLOAT_WINDOW_MIN_SIZE = { minWidth: 320, minHeight: 280 };

class FloatingWindowRegistry implements FloatingWindowRegistryAPI {
  private detached = new Map<string, DetachedEntry>();
  private listeners = new Set<() => void>();
  private bridgeReady = false;

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

    const windowLabel = `floating-${viewId}`;
    this.detached.set(viewId, { windowLabel, panel });
    this.notify();

    await this.spawnWindow(viewId, windowLabel, spawnHint);
  }

  async redock(viewId: string): Promise<void> {
    const entry = this.detached.get(viewId);
    if (!entry) return;
    this.detached.delete(viewId);
    this.notify();
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

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async focus(viewId: string): Promise<void> {
    const entry = this.detached.get(viewId);
    if (!entry) return;
    await this.focusWindow(entry.windowLabel);
  }

  __resetForTests(): void {
    this.detached.clear();
    this.listeners.clear();
    this.bridgeReady = false;
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
      });

      // Float-side "Dock back" button → close window + clean up state.
      await listen<{ viewId: string }>("floating-window:redock-request", (event) => {
        const viewId = event.payload?.viewId;
        if (typeof viewId !== "string") return;
        void this.redock(viewId);
      });

      this.bridgeReady = true;
    } catch (err) {
      logger.warn("[floating] event bridge init failed:", err);
      this.bridgeReady = true;
    }
  }

  private async spawnWindow(
    viewId: string,
    windowLabel: string,
    spawnHint?: { x: number; y: number; title?: string },
  ): Promise<void> {
    if (!isTauri()) return;
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const url = `/floating?view=${encodeURIComponent(viewId)}`;
      const win = new WebviewWindow(windowLabel, {
        url,
        title: spawnHint?.title ?? "Trixty IDE",
        width: FLOAT_WINDOW_DEFAULT_SIZE.width,
        height: FLOAT_WINDOW_DEFAULT_SIZE.height,
        ...FLOAT_WINDOW_MIN_SIZE,
        decorations: false,
        transparent: false,
        center: !spawnHint,
        x: spawnHint?.x,
        y: spawnHint?.y,
      });
      win.once("tauri://error", (err) => {
        logger.warn(`[floating] WebviewWindow ${windowLabel} reported error:`, err);
      });
    } catch (err) {
      logger.error(`[floating] failed to spawn ${windowLabel}:`, err);
      // Roll back the registry entry so the slot does not show the placeholder
      // for a window that never came up.
      this.detached.delete(viewId);
      this.notify();
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
