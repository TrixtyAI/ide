"use client";

import { trixtyStore } from "@/api/store";
import { logger } from "@/lib/logger";

const LOCALSTORAGE_PANEL_PREFIX = "react-resizable-panels:";
const STORE_KEYS_TO_CLEAR = [
  "trixty.ui.panels",
  "trixty.floating.detached",
];

// Layout-storage IDs that older builds wrote to before the `.v3` rename
// (numeric size props were being interpreted as pixels, so any saved
// values are now misleading). Idempotent — if the keys are gone, this
// does nothing.
const LEGACY_LAYOUT_ID_PREFIXES = [
  "react-resizable-panels:trixty.layout.main-h:",
  "react-resizable-panels:trixty.layout.main-h.v2:",
];

/**
 * Best-effort one-shot cleanup of layout keys saved by older builds. Safe
 * to call on every boot: idempotent and only touches the legacy prefixes.
 */
export function cleanLegacyLayoutKeys(): void {
  if (typeof window === "undefined") return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (LEGACY_LAYOUT_ID_PREFIXES.some((p) => k.startsWith(p))) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) window.localStorage.removeItem(k);
    if (keysToRemove.length > 0) {
      logger.debug(
        `[layoutReset] cleaned ${keysToRemove.length} legacy layout key(s)`,
      );
    }
  } catch (err) {
    logger.warn("[layoutReset] legacy cleanup failed:", err);
  }
}

/**
 * Reset all UI layout state to defaults: panel sizes (localStorage), open
 * flags + active sidebar tab (Tauri store), and any detached floating-view
 * registrations. The active workspace, settings, theme, and chat history
 * are intentionally untouched — this is a layout-only reset.
 *
 * Caller is responsible for the confirmation prompt and reload — the
 * function only clears persisted state.
 */
export async function resetLayout(): Promise<void> {
  // Drop every react-resizable-panels layout key. The lib stores one
  // entry per panel-set combination, so we cannot just hit a fixed list.
  if (typeof window !== "undefined") {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(LOCALSTORAGE_PANEL_PREFIX)) keysToRemove.push(k);
      }
      for (const k of keysToRemove) window.localStorage.removeItem(k);
    } catch (err) {
      logger.warn("[layoutReset] localStorage cleanup failed:", err);
    }
  }

  for (const key of STORE_KEYS_TO_CLEAR) {
    try {
      await trixtyStore.delete(key);
    } catch (err) {
      logger.warn(`[layoutReset] failed to delete ${key}:`, err);
    }
  }
}
