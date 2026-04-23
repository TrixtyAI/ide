import { useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 *
 * Implementation notes:
 *
 * - Uses `useSyncExternalStore` so the match flag is always consistent with
 *   the DOM at render time — concurrent React renders cannot observe a stale
 *   value from the subscribe cycle.
 * - Exposes a `getServerSnapshot` that returns `false`. The desktop app is
 *   always client-rendered inside Tauri, but Next 16 prerenders `/_not-found`
 *   through the full provider tree on the build server; any `useSyncExternalStore`
 *   reachable from that tree MUST provide `getServerSnapshot` or the Test Build
 *   CI workflow fails. Returning `false` pretends the responsive breakpoint
 *   is NOT met on the server — on the client the first effect run re-reads
 *   the real value and triggers a re-render if it differs.
 */
export function useMediaQuery(query: string): boolean {
  const getSnapshot = () => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(query).matches;
  };

  const subscribe = (onChange: () => void) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return () => {};
    }
    const mql = window.matchMedia(query);
    // `addEventListener("change", ...)` is the modern API; older WebKit /
    // WebView2 releases only expose the deprecated `addListener` pair. Tauri
    // v2 ships recent WebView2 on Windows and WKWebView on macOS, both of
    // which have the modern API, but guarding it keeps the hook safe to
    // reuse in any future embed context.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  };

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
