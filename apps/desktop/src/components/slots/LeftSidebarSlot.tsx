"use client";
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { trixty, WebviewView } from "@/api/trixty";
import { ExternalLink } from "lucide-react";
import { useUI } from "@/context/UIContext";
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

interface LeftSidebarSlotProps {
    /** ViewId currently overlapping main window enough to be a redock
     *  candidate. Owned by `useFloatingDockTracker` at the shell level. */
    overlayViewId?: string | null;
}

export default function LeftSidebarSlot({ overlayViewId = null }: LeftSidebarSlotProps) {
    const [views, setViews] = useState<WebviewView[]>([]);
    const slotRef = useRef<HTMLDivElement | null>(null);
    const { t } = useL10n();

    // Re-render when the floating registry changes so the active view's
    // detached state propagates here (matches RightPanelSlot's pattern).
    useFloatingRegistrySnapshot();

    useEffect(() => {
        const update = () => setViews(trixty.window.getLeftPanelViews());
        update();
        return trixty.window.subscribe(update);
    }, []);

    const { activeSidebarTab } = useUI();

    if (views.length === 0) {
        return <div className="flex-1 flex flex-col items-center justify-center text-[#666] text-[11px] p-4 text-center">No Sidebar addons active</div>;
    }

    const activeView = views.find(v => v.id === activeSidebarTab) || views[0];
    if (!activeView) return null;

    // Show drop-zone hint only for left-panel floats overlapping the main
    // window. Right-panel floats are handled by RightPanelSlot's own overlay.
    const showOverlay =
        overlayViewId !== null &&
        floatingWindowRegistry.getEntry(overlayViewId)?.panel === "left";
    const overlayView = showOverlay
        ? views.find((v) => v.id === overlayViewId)
        : undefined;

    return (
        <div ref={slotRef} className="relative flex flex-col h-full w-full">
            <DetachableLeftView view={activeView} slotRef={slotRef} t={t} />
            {overlayView ? (
                <DropZoneOverlay viewName={t(overlayView.title)} />
            ) : null}
        </div>
    );
}

interface DetachableLeftViewProps {
    view: WebviewView;
    slotRef: React.RefObject<HTMLDivElement | null>;
    t: (key: string, params?: Record<string, string>) => string;
}

function DetachableLeftView({ view, slotRef, t }: DetachableLeftViewProps) {
    const isDetached = floatingWindowRegistry.isDetached(view.id);
    const ViewRender = view.render;

    const { onMouseDown, popOutButtonProps } = useDetachableHeader({
        viewId: view.id,
        panel: "left",
        slotElementRef: slotRef,
        windowTitle: t(view.title),
        popOutLabel: t("panel.view.popout"),
    });

    const redock = useCallback(() => {
        void floatingWindowRegistry.redock(view.id);
    }, [view.id]);

    const focus = useCallback(() => {
        void floatingWindowRegistry.focus(view.id);
    }, [view.id]);

    if (isDetached) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-[#777] text-[11px] gap-3 p-6 text-center">
                <span>{t("panel.view.in_floating_window", { name: t(view.title) })}</span>
                <div className="flex gap-2">
                    <button
                        onClick={focus}
                        className="px-3 py-1.5 text-[11px] bg-white/5 hover:bg-white/10 text-white rounded border border-white/10 transition-colors"
                    >
                        {t("panel.view.bring_to_front")}
                    </button>
                    <button
                        onClick={redock}
                        className="px-3 py-1.5 text-[11px] bg-blue-500/15 hover:bg-blue-500/25 text-blue-200 rounded border border-blue-500/30 transition-colors"
                    >
                        {t("panel.view.dock_back")}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="relative flex-1 flex flex-col h-full overflow-hidden">
            {/* Detach affordance: a small pop-out button + drag-from-top
                region that mirrors the right-panel UX. The button is
                absolute-positioned so addons keep full control of their
                own UI underneath. */}
            <div
                onMouseDown={onMouseDown}
                className="absolute top-1 right-1 z-10 flex items-center gap-1 select-none"
            >
                <button
                    {...popOutButtonProps}
                    className="p-1 text-[#777] hover:text-white rounded hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                    <ExternalLink size={12} strokeWidth={1.5} />
                </button>
            </div>
            <ViewRender />
        </div>
    );
}
