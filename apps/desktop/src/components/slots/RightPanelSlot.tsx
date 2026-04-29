"use client";
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { trixty, WebviewView } from "@/api/trixty";
import { ChevronRight, ExternalLink } from "lucide-react";
import { useL10n } from "@/hooks/useL10n";
import { useDetachableHeader } from "@/hooks/useDetachableHeader";
import { floatingWindowRegistry } from "@/api/floatingWindowRegistry";
import DropZoneOverlay from "@/components/DropZoneOverlay";

function useFloatingRegistrySnapshot() {
  return useSyncExternalStore(
    floatingWindowRegistry.subscribe,
    () => floatingWindowRegistry.list().length,
    () => 0,
  );
}

interface RightPanelSlotProps {
  /** ViewId currently overlapping main window enough to be a redock
   *  candidate. Owned by `useFloatingDockTracker` at the shell level. */
  overlayViewId?: string | null;
}

export default function RightPanelSlot({ overlayViewId = null }: RightPanelSlotProps) {
  const [views, setViews] = useState<WebviewView[]>([]);
  const { t } = useL10n();
  const slotRef = useRef<HTMLDivElement | null>(null);

  const [collapsedViews, setCollapsedViews] = useState<Record<string, boolean>>({});

  // Force re-render when the registry changes.
  useFloatingRegistrySnapshot();

  useEffect(() => {
    const update = () => setViews(trixty.window.getRightPanelViews());
    update();
    return trixty.window.subscribe(update);
  }, []);

  const toggleView = useCallback((id: string) => {
    setCollapsedViews((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Show the drop-zone hint only when the moving float belongs to a
  // right-panel view. Left-panel floats trigger the overlay on
  // LeftSidebarSlot instead.
  const showOverlay =
    overlayViewId !== null &&
    floatingWindowRegistry.getEntry(overlayViewId)?.panel === "right";
  const overlayView = showOverlay
    ? views.find((v) => v.id === overlayViewId)
    : undefined;

  // Drag-tracking + redock decision live in the shell-level
  // `useFloatingDockTracker` hook. Slots only render the visual hint.

  if (views.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#666] text-xs h-full bg-[#0e0e0e]">
        {t("panel.right.no_addons")}
      </div>
    );
  }

  return (
    <div ref={slotRef} className="relative flex flex-col h-full w-full bg-[#0e0e0e] divide-y divide-[#1a1a1a]">
      {views.map((view) => (
        <DetachableViewSection
          key={view.id}
          view={view}
          slotRef={slotRef}
          isCollapsed={!!collapsedViews[view.id]}
          onToggleCollapse={toggleView}
        />
      ))}
      {overlayView ? (
        <DropZoneOverlay viewName={t(overlayView.title)} />
      ) : null}
    </div>
  );
}

interface SectionProps {
  view: WebviewView;
  slotRef: React.RefObject<HTMLDivElement | null>;
  isCollapsed: boolean;
  onToggleCollapse: (id: string) => void;
}

function DetachableViewSection({ view, slotRef, isCollapsed, onToggleCollapse }: SectionProps) {
  const { t } = useL10n();
  const isDetached = floatingWindowRegistry.isDetached(view.id);
  const ViewRender = view.render;

  const { onMouseDown, popOutButtonProps } = useDetachableHeader({
    viewId: view.id,
    panel: "right",
    slotElementRef: slotRef,
    windowTitle: t(view.title),
    popOutLabel: t("panel.view.popout"),
  });

  return (
    <div
      className={`flex flex-col overflow-hidden transition-all ${
        isCollapsed ? "flex-none" : "flex-1 min-h-[150px]"
      }`}
    >
      <div
        onMouseDown={isDetached ? undefined : onMouseDown}
        className="border-b border-[#222] bg-[#141414] px-2 py-1.5 flex items-center gap-2 select-none transition-colors hover:bg-[#1a1a1a]"
      >
        <button
          data-collapse-trigger="true"
          onClick={() => onToggleCollapse(view.id)}
          aria-label={t("panel.view.collapse")}
          className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
        >
          <ChevronRight
            size={14}
            className={`text-[#666] transition-transform shrink-0 ${
              isCollapsed ? "" : "rotate-90"
            }`}
          />
          {view.icon}
          <span className="text-[10px] text-[#999] uppercase font-bold tracking-wider truncate">
            {t(view.title)}
          </span>
        </button>
        {!isDetached ? (
          <button
            {...popOutButtonProps}
            className="p-1 text-[#777] hover:text-white rounded hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <ExternalLink size={12} strokeWidth={1.5} />
          </button>
        ) : null}
      </div>
      {!isCollapsed ? (
        <div className="flex-1 overflow-hidden relative flex flex-col">
          {isDetached ? (
            <div className="flex-1 flex flex-col items-center justify-center text-[#777] text-[11px] gap-3 p-6 text-center">
              <span>{t("panel.view.in_floating_window", { name: t(view.title) })}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => void floatingWindowRegistry.focus(view.id)}
                  className="px-3 py-1.5 text-[11px] bg-white/5 hover:bg-white/10 text-white rounded border border-white/10 transition-colors"
                >
                  {t("panel.view.bring_to_front")}
                </button>
                <button
                  onClick={() => void floatingWindowRegistry.redock(view.id)}
                  className="px-3 py-1.5 text-[11px] bg-blue-500/15 hover:bg-blue-500/25 text-blue-200 rounded border border-blue-500/30 transition-colors"
                >
                  {t("panel.view.dock_back")}
                </button>
              </div>
            </div>
          ) : (
            <ViewRender />
          )}
        </div>
      ) : null}
    </div>
  );
}
