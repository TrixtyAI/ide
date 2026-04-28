"use client";
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { trixty, WebviewView } from "@/api/trixty";
import { ChevronRight, ExternalLink } from "lucide-react";
import { useL10n } from "@/hooks/useL10n";
import { useDetachableHeader } from "@/hooks/useDetachableHeader";
import { floatingWindowRegistry } from "@/api/floatingWindowRegistry";
import DropZoneOverlay from "@/components/DropZoneOverlay";
import { isTauri } from "@/api/tauri";
import { logger } from "@/lib/logger";

const REDOCK_OVERLAP_THRESHOLD = 0.3;
const REDOCK_SETTLE_MS = 200;

interface MainRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FloatMoveEvent {
  viewId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function useFloatingRegistrySnapshot() {
  return useSyncExternalStore(
    floatingWindowRegistry.subscribe,
    () => floatingWindowRegistry.list().length,
    () => 0,
  );
}

export default function RightPanelSlot() {
  const [views, setViews] = useState<WebviewView[]>([]);
  const { t } = useL10n();
  const slotRef = useRef<HTMLDivElement | null>(null);

  const [collapsedViews, setCollapsedViews] = useState<Record<string, boolean>>({});
  const [overlayViewId, setOverlayViewId] = useState<string | null>(null);

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

  // Listen for floating-window moves and decide when to show the drop zone.
  useEffect(() => {
    if (!isTauri()) return;
    let unsubscribed = false;
    let unlisten: (() => void) | undefined;
    let mainRect: MainRect | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let lastEvent: FloatMoveEvent | null = null;
    let currentOverlayViewId: string | null = null;

    const refreshMainRect = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        mainRect = { x: pos.x, y: pos.y, w: size.width, h: size.height };
      } catch (err) {
        logger.debug("[floating] mainRect refresh failed:", err);
      }
    };

    const overlapFraction = (a: MainRect, b: FloatMoveEvent): number => {
      const overlapW = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const overlapH = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const overlapArea = overlapW * overlapH;
      const floatArea = Math.max(1, b.w * b.h);
      return overlapArea / floatArea;
    };

    const setOverlay = (next: string | null) => {
      if (currentOverlayViewId === next) return;
      currentOverlayViewId = next;
      setOverlayViewId(next);
    };

    const settleAndMaybeRedock = (event: FloatMoveEvent) => {
      if (!mainRect) return;
      const fraction = overlapFraction(mainRect, event);
      if (fraction >= REDOCK_OVERLAP_THRESHOLD) {
        setOverlay(event.viewId);
      } else if (currentOverlayViewId === event.viewId) {
        setOverlay(null);
      }

      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (!mainRect || !lastEvent) return;
        const finalFraction = overlapFraction(mainRect, lastEvent);
        if (finalFraction >= REDOCK_OVERLAP_THRESHOLD) {
          setOverlay(null);
          void floatingWindowRegistry.redock(lastEvent.viewId);
        } else {
          setOverlay(null);
        }
      }, REDOCK_SETTLE_MS);
    };

    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const { listen } = await import("@tauri-apps/api/event");
        const win = getCurrentWindow();

        await refreshMainRect();
        const moveHandle = await win.onMoved(refreshMainRect);
        const resizeHandle = await win.onResized(refreshMainRect);

        const eventHandle = await listen<FloatMoveEvent>(
          "floating-window:moved",
          (event) => {
            if (!event.payload || typeof event.payload.viewId !== "string") return;
            lastEvent = event.payload;
            settleAndMaybeRedock(event.payload);
          },
        );

        if (unsubscribed) {
          moveHandle();
          resizeHandle();
          eventHandle();
        } else {
          unlisten = () => {
            moveHandle();
            resizeHandle();
            eventHandle();
          };
        }
      } catch (err) {
        logger.warn("[floating] main-window listener init failed:", err);
      }
    })();

    return () => {
      unsubscribed = true;
      if (settleTimer) clearTimeout(settleTimer);
      if (unlisten) unlisten();
    };
  }, []);

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
      {overlayViewId ? (
        <DropZoneOverlay
          viewName={t(views.find((v) => v.id === overlayViewId)?.title ?? "")}
        />
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
