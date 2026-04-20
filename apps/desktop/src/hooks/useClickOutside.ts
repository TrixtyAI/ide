"use client";

import { useEffect, type RefObject } from "react";

/**
 * Calls `handler` whenever a `mousedown` fires outside the element referenced by `ref`.
 * The listener is attached to `document` and cleaned up on unmount or when
 * `enabled` transitions to `false`.
 *
 * Pass `enabled: false` to pause the listener (useful when the target element
 * is only rendered conditionally, e.g. a closed menu).
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  handler: (event: MouseEvent) => void,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (ref.current && target && !ref.current.contains(target)) {
        handler(event);
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [ref, handler, enabled]);
}
