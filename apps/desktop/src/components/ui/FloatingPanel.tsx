"use client";

import React from "react";
import { cn } from "@/lib/utils";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

interface FloatingPanelProps extends DivProps {
  /**
   * Shape of the panel — governs border radius and backdrop blur strength.
   * - `menu`   : rounded-2xl / backdrop-blur-2xl (matches ContextMenu, the heaviest caller)
   * - `popover`: rounded-xl  / backdrop-blur-xl  (matches the AI-chat model dropdown)
   */
  shape?: "menu" | "popover";
  /**
   * When `true` (default), a translucent 95% surface is used — matches the
   * current callers. Set to `false` for a fully opaque variant.
   */
  translucent?: boolean;
  /**
   * Ref forwarded to the underlying `<div>`. React 19 accepts `ref` as a
   * plain prop — no `forwardRef` wrapper needed.
   */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * Shared floating-surface primitive used by menus, context menus, and
 * dropdown popovers across the app. Extracted to consolidate the
 * `backdrop-blur-*` + `border-white/10` + dark translucent background
 * recipe that was previously duplicated in ContextMenu and the AI-chat
 * model picker.
 *
 * Consumers own the positioning (pass `fixed`/`absolute` + `top`/`left`
 * via `className` or `style`). This primitive only supplies the surface
 * styling.
 *
 * NOTE: The AI-chat model-menu consumer at `AiChatComponent.tsx:~642`
 * is intentionally NOT migrated in this PR because PR #238 rewrites
 * that JSX as an ARIA listbox. Adoption follows once #238 merges.
 */
const FloatingPanel: React.FC<FloatingPanelProps> = ({
  shape = "menu",
  translucent = true,
  className,
  children,
  ref,
  ...rest
}) => {
  return (
    <div
      ref={ref}
      className={cn(
        "border border-white/10 shadow-2xl overflow-hidden",
        shape === "menu"
          ? "rounded-2xl backdrop-blur-2xl"
          : "rounded-xl backdrop-blur-xl",
        translucent ? "bg-surface-2/95" : "bg-surface-2",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
};

export default FloatingPanel;
