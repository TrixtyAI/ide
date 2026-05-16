import { useCallback, useRef } from "react";
import { floatingWindowRegistry, type DetachablePanel } from "@/api/floatingWindowRegistry";

interface Args {
  viewId: string;
  panel: DetachablePanel;
  /** Slot container so we can compute "cursor outside the slot rect". */
  slotElementRef: React.RefObject<HTMLElement | null>;
  /** Title used for the spawned window; falls back to "Trixty IDE". */
  windowTitle?: string;
  /** Localized aria-label / tooltip for the explicit "Pop out" button. */
  popOutLabel?: string;
}

interface UseDetachableHeaderReturn {
  onMouseDown: (event: React.MouseEvent<HTMLElement>) => void;
  popOutButtonProps: {
    "data-popout-trigger": "true";
    onClick: (event: React.MouseEvent<HTMLElement>) => void;
    "aria-label": string;
    title: string;
  };
}

const DRAG_THRESHOLD_PX = 40;
const DRAG_THRESHOLD_SQ = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;

/**
 * Wires up the two pop-out triggers (header drag + explicit button) for a
 * single detachable view. The drag detection ignores mousedowns on elements
 * carrying `data-popout-trigger` or `data-collapse-trigger`, so those keep
 * their own click semantics.
 */
export function useDetachableHeader({
  viewId,
  panel,
  slotElementRef,
  windowTitle,
  popOutLabel,
}: Args): UseDetachableHeaderReturn {
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);

  const fireDetach = useCallback(
    (cursorX: number, cursorY: number) => {
      void floatingWindowRegistry.detach(viewId, panel, {
        x: Math.max(0, cursorX - 60),
        y: Math.max(0, cursorY - 16),
        title: windowTitle,
      });
    },
    [viewId, panel, windowTitle],
  );

  const onMouseDown = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (event.target instanceof HTMLElement) {
        if (
          event.target.closest("[data-popout-trigger]") ||
          event.target.closest("[data-collapse-trigger]")
        ) {
          return;
        }
      }
      dragOriginRef.current = { x: event.clientX, y: event.clientY };

      const handleMove = (e: MouseEvent) => {
        const origin = dragOriginRef.current;
        if (!origin) return;
        const dx = e.clientX - origin.x;
        const dy = e.clientY - origin.y;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_SQ) return;

        const slot = slotElementRef.current;
        if (!slot) return;
        const rect = slot.getBoundingClientRect();
        const inside =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        if (inside) return;

        cleanup();
        fireDetach(e.screenX, e.screenY);
      };

      const handleUp = () => {
        cleanup();
      };

      const cleanup = () => {
        dragOriginRef.current = null;
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [slotElementRef, fireDetach],
  );

  const label = popOutLabel ?? "Open in floating window";
  const popOutButtonProps: UseDetachableHeaderReturn["popOutButtonProps"] = {
    "data-popout-trigger": "true",
    onClick: (event) => {
      event.stopPropagation();
      fireDetach(event.screenX, event.screenY);
    },
    "aria-label": label,
    title: label,
  };

  return { onMouseDown, popOutButtonProps };
}
