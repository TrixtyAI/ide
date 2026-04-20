"use client";

import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@/api/tauri";

interface UseTauriWindowResult {
  /** Whether the app is running inside the Tauri native shell. */
  isNativeWindow: boolean;
  /** Tracks the current maximize state of the native window. Defaults to `false` in non-Tauri contexts. */
  isMaximized: boolean;
  /** Minimizes the native window. No-op in non-Tauri contexts. */
  minimize: () => Promise<void>;
  /** Toggles the maximize / restore state of the native window. No-op in non-Tauri contexts. */
  toggleMaximize: () => Promise<void>;
  /** Requests the native window to close. No-op in non-Tauri contexts. */
  close: () => Promise<void>;
}

/**
 * Centralises Tauri native-window interactions used by the title bar and the
 * onboarding wizard so both share the same detection, cleanup and state.
 *
 * The hook dynamically imports `@tauri-apps/api/window` to keep the module tree
 * safe in non-Tauri (browser / SSR) contexts.
 */
export function useTauriWindow(): UseTauriWindowResult {
  const [isNativeWindow, setIsNativeWindow] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;

    let mounted = true;
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const maximized = await win.isMaximized();
        if (!mounted) return;
        setIsNativeWindow(true);
        setIsMaximized(maximized);

        const unlisten = await win.onResized(async () => {
          const m = await win.isMaximized();
          if (mounted) setIsMaximized(m);
        });

        if (!mounted) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      } catch {
        // Window API not available — fall back to non-native behaviour.
      }
    })();

    return () => {
      mounted = false;
      if (cleanup) cleanup();
    };
  }, []);

  const minimize = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch {
      // swallow: window API unavailable
    }
  }, []);

  const toggleMaximize = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      await win.toggleMaximize();
      setIsMaximized(await win.isMaximized());
    } catch {
      // swallow: window API unavailable
    }
  }, []);

  const close = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      // swallow: window API unavailable
    }
  }, []);

  return { isNativeWindow, isMaximized, minimize, toggleMaximize, close };
}
