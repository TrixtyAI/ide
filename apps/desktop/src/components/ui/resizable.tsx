"use client";

import * as ResizablePrimitive from "react-resizable-panels";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) => (
  <ResizablePrimitive.Group
    className={cn(
      "flex h-full w-full",
      // v4 renamed `direction` → `orientation`. Toggle the column flex
      // direction here so callers don't have to wrap the group themselves
      // when going vertical.
      (props as { orientation?: "horizontal" | "vertical" }).orientation === "vertical" && "flex-col",
      className
    )}
    {...props}
  />
);

const ResizablePanel = ResizablePrimitive.Panel;

// react-resizable-panels v4 emits `aria-orientation` on the Separator and
// it is the OPPOSITE of the parent Group's `orientation`:
//   - horizontal group → separator aria-orientation = "vertical"   (skinny vertical bar, drag left/right)
//   - vertical   group → separator aria-orientation = "horizontal" (skinny horizontal bar, drag up/down)
// The legacy `data-panel-group-direction` attribute is gone in v4, so the
// shadcn-ish selectors below were dead. Switching to `aria-[orientation=...]`
// makes the handle render correctly in both orientations and gives users a
// real hit-target instead of a 1 px line they cannot grab.
const ResizableHandle = ({
  withHandle,
  className,
  title = "Drag to resize · Double-click to reset",
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean;
}) => (
  <ResizablePrimitive.Separator
    title={title}
    className={cn(
      // 4 px hit target with a 1 px visible line centered on it. On hover
      // expand the line to 2 px and brighten so the user can see which
      // edge they are about to grab — VSCode does the same.
      "relative flex items-center justify-center bg-transparent transition-colors",
      // Vertical separator (horizontal group): drag left/right.
      "aria-[orientation=vertical]:w-1 aria-[orientation=vertical]:h-full",
      "aria-[orientation=vertical]:after:absolute aria-[orientation=vertical]:after:inset-y-0 aria-[orientation=vertical]:after:left-1/2 aria-[orientation=vertical]:after:-translate-x-1/2 aria-[orientation=vertical]:after:w-px aria-[orientation=vertical]:after:bg-[#1a1a1a] aria-[orientation=vertical]:after:transition-all",
      "hover:aria-[orientation=vertical]:after:w-[2px] hover:aria-[orientation=vertical]:after:bg-[#3b82f6]/70",
      // Horizontal separator (vertical group): drag up/down.
      "aria-[orientation=horizontal]:h-1 aria-[orientation=horizontal]:w-full",
      "aria-[orientation=horizontal]:after:absolute aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:-translate-y-1/2 aria-[orientation=horizontal]:after:h-px aria-[orientation=horizontal]:after:bg-[#1a1a1a] aria-[orientation=horizontal]:after:transition-all",
      "hover:aria-[orientation=horizontal]:after:h-[2px] hover:aria-[orientation=horizontal]:after:bg-[#3b82f6]/70",
      "focus-visible:outline-none focus-visible:after:bg-[#3b82f6]",
      "[&[aria-orientation=horizontal]>div]:rotate-90",
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-[#2b2b2b] bg-[#1e1e1e]">
        <GripVertical className="h-2.5 w-2.5 text-[#858585]" />
      </div>
    )}
  </ResizablePrimitive.Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
