"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface TooltipProps {
  /** Tooltip label text. */
  label: string;
  /**
   * Side to place the tooltip relative to its parent. Defaults to `right`
   * to match the ActivityBar flyout placement. Parent must be
   * `position: relative` and have the `group` class so `group-hover`
   * opacity triggers.
   */
  side?: "right" | "top" | "bottom" | "left";
  /** Extra classes merged onto the tooltip wrapper. */
  className?: string;
}

// Positioning classes intentionally match the pre-refactor ActivityBar
// markup byte-for-byte for the `right` side (no vertical centering, top
// aligned to the parent). Other sides are provided for future callers and
// use simple axis-aligned offsets.
const TOOLTIP_SIDE_CLASSES: Record<NonNullable<TooltipProps["side"]>, string> = {
  right: "left-full ml-3",
  left: "right-full mr-3",
  top: "bottom-full mb-2",
  bottom: "top-full mt-2",
};

/**
 * Lightweight CSS-only hover tooltip. Pairs with a `relative group`
 * parent: the tooltip fades in on `group-hover` and is otherwise inert
 * (`pointer-events-none`, `aria-hidden`).
 *
 * This primitive replaces three byte-identical copies of the same
 * flyout markup inside `ActivityBar.tsx`. Visual output is equivalent
 * to the pre-refactor JSX for the default `side="right"` placement.
 */
const Tooltip: React.FC<TooltipProps> = ({ label, side = "right", className }) => {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "absolute px-2.5 py-1.5 bg-surface-3 text-white text-caption rounded-md border border-border-strong opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-tooltip transition-opacity shadow-xl",
        TOOLTIP_SIDE_CLASSES[side],
        className,
      )}
    >
      {label}
    </div>
  );
};

export default Tooltip;
