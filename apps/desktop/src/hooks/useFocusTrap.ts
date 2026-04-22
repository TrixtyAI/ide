import { useEffect, useRef, type RefObject } from "react";

// Standard focusable-elements selector. Matches what most a11y libraries
// ship; kept in sync with the WAI-ARIA authoring practices list.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusables(root: HTMLElement): HTMLElement[] {
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  // `offsetParent === null` hides elements in `display:none` subtrees. Keep
  // the currently-focused element regardless so a `position:fixed` child
  // (whose offsetParent is legitimately null) is not stripped.
  return nodes.filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

type Options = {
  /** When false the hook is inert. Flip to true once the dialog is mounted. */
  active: boolean;
  /** Ref to the dialog root. Must be focusable (e.g. `tabIndex={-1}`). */
  containerRef: RefObject<HTMLElement | null>;
  /** Invoked on Escape. Callers typically close the dialog. */
  onEscape: () => void;
};

/**
 * Implements the a11y contract for a modal dialog:
 *
 * - Moves focus into the dialog on activation (first focusable, or the
 *   container itself as a fallback).
 * - Traps Tab / Shift+Tab so focus cannot leave the dialog.
 * - Listens for Escape on `document` (so the handler fires even when no
 *   element inside the dialog has keyboard focus).
 * - Restores focus to whatever had it before the dialog opened, provided
 *   that element is still in the DOM.
 */
export function useFocusTrap({ active, containerRef, onEscape }: Options) {
  // Indirect through a ref so the listener effect does not re-run when the
  // caller passes an inline `onEscape` lambda — that would reset
  // `previouslyFocused` to an element *inside* the dialog and break
  // return-focus on close.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const initialTarget = getFocusables(container)[0] ?? container;
    initialTarget.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = getFocusables(container);
      if (focusables.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement as HTMLElement | null;

      if (!container.contains(current)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (
        previouslyFocused &&
        typeof previouslyFocused.focus === "function" &&
        document.body.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, [active, containerRef]);
}
