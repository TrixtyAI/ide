"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@/api/tauri";

type TauriWindowModule = typeof import("@tauri-apps/api/window");
type TauriWindow = ReturnType<TauriWindowModule["getCurrentWindow"]>;

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
 * The window handle is fetched once and cached in a ref, so subsequent actions
 * reuse it instead of re-importing `@tauri-apps/api/window` per call.
 */
export function useTauriWindow(): UseTauriWindowResult {
  const [isNativeWindow, setIsNativeWindow] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const isMountedRef = useRef(true);
  const winPromiseRef = useRef<Promise<TauriWindow | null> | null>(null);

  const getWin = useCallback((): Promise<TauriWindow | null> => {
    if (!isTauri()) return Promise.resolve(null);
    if (!winPromiseRef.current) {
      winPromiseRef.current = import("@tauri-apps/api/window")
        .then((mod) => mod.getCurrentWindow())
        .catch(() => null);
    }
    return winPromiseRef.current;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (!isTauri()) {
      return () => {
        isMountedRef.current = false;
      };
    }

    let cleanup: (() => void) | undefined;

    (async () => {
      const win = await getWin();
      if (!isMountedRef.current || !win) return;

      // Declare native as soon as the window handle resolves — don't let a
      // failure in isMaximized() hide the native environment.
      setIsNativeWindow(true);

      try {
        const maximized = await win.isMaximized();
        if (isMountedRef.current) setIsMaximized(maximized);
      } catch {
        // Maximize state unavailable — keep native detection enabled.
      }

      try {
        const unlisten = await win.onResized(async () => {
          try {
            const m = await win.isMaximized();
            if (isMountedRef.current) setIsMaximized(m);
          } catch {
            // Maximize state unavailable during resize updates.
          }
        });
        if (!isMountedRef.current) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      } catch {
        // onResized unavailable — no live tracking, initial state stays.
      }
    })();

    return () => {
      isMountedRef.current = false;
      if (cleanup) cleanup();
    };
  }, [getWin]);

  const minimize = useCallback(async () => {
    const win = await getWin();
    if (!win) return;
    try {
      await win.minimize();
    } catch {
      // swallow: window API transient failure
    }
  }, [getWin]);

  const toggleMaximize = useCallback(async () => {
    const win = await getWin();
    if (!win) return;
    try {
      await win.toggleMaximize();
      const next = await win.isMaximized();
      if (isMountedRef.current) setIsMaximized(next);
    } catch {
      // swallow: window API transient failure
    }
  }, [getWin]);

  const close = useCallback(async () => {
    const win = await getWin();
    if (!win) return;
    try {
      await win.close();
    } catch {
      // swallow: window API transient failure
    }
  }, [getWin]);

  return { isNativeWindow, isMaximized, minimize, toggleMaximize, close };
}
