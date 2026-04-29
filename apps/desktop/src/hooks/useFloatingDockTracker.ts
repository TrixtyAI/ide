"use client";

import { useEffect, useState } from "react";
import { isTauri } from "@/api/tauri";
import { floatingWindowRegistry } from "@/api/floatingWindowRegistry";
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

/**
 * Tracks which floating-window view is currently overlapping the main
 * window enough to be a redock candidate, and triggers a `redock()` after
 * a short settle period.
 *
 * Hoisting this out of `RightPanelSlot` lets both the right and left
 * panel slots share a single drag-detection loop, so a left-side detached
 * view can also surface a drop-zone hint and re-dock by drag.
 *
 * Returns the `viewId` currently selected for redock (or `null`). The
 * caller can look up `floatingWindowRegistry.getEntry(viewId).panel` to
 * decide which slot should actually render the overlay.
 */
export function useFloatingDockTracker(): { overlayViewId: string | null } {
  const [overlayViewId, setOverlayViewId] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let unsubscribed = false;
    let unlisten: (() => void) | undefined;
    let mainRect: MainRect | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let lastEvent: FloatMoveEvent | null = null;
    let currentOverlayViewId: string | null = null;
    // Tracks viewIds whose float window has been observed below the redock
    // overlap threshold at least once. Without this, a float that spawns
    // over the main window — which is the common case, since detach uses
    // the cursor as the spawn hint — would emit one initial "moved" event
    // with overlap >= 30 %, fire the settle timer with no follow-up moves,
    // and trigger an auto-redock that closes the window the user just
    // opened. We only consider redock once the user has actually pulled
    // the float away first.
    const everSawBelow = new Set<string>();

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

      if (fraction < REDOCK_OVERLAP_THRESHOLD) {
        everSawBelow.add(event.viewId);
        if (currentOverlayViewId === event.viewId) setOverlay(null);
        if (settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
        return;
      }

      if (!everSawBelow.has(event.viewId)) {
        // Float spawned over the main window and has not been pulled
        // away yet — do not arm the auto-redock or the user loses the
        // window they just opened.
        return;
      }

      setOverlay(event.viewId);

      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (!mainRect || !lastEvent) return;
        const finalFraction = overlapFraction(mainRect, lastEvent);
        if (
          finalFraction >= REDOCK_OVERLAP_THRESHOLD &&
          everSawBelow.has(lastEvent.viewId)
        ) {
          setOverlay(null);
          everSawBelow.delete(lastEvent.viewId);
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

        const closedHandle = await listen<{ viewId: string }>(
          "floating-window:closed",
          (event) => {
            const viewId = event.payload?.viewId;
            if (typeof viewId !== "string") return;
            everSawBelow.delete(viewId);
            if (lastEvent?.viewId === viewId) lastEvent = null;
            if (currentOverlayViewId === viewId) setOverlay(null);
          },
        );

        if (unsubscribed) {
          moveHandle();
          resizeHandle();
          eventHandle();
          closedHandle();
        } else {
          unlisten = () => {
            moveHandle();
            resizeHandle();
            eventHandle();
            closedHandle();
          };
        }
      } catch (err) {
        logger.warn("[floating] dock-tracker init failed:", err);
      }
    })();

    // Prune `everSawBelow` whenever the registry's detached set
    // changes — covers the case where a redock came in via the float
    // window's "Dock back" button or via `redock()` directly (closes
    // the window without giving the float page a chance to fire its
    // own `floating-window:closed` listener). Without this, the same
    // viewId re-detached later would inherit a stale "saw below"
    // flag and never auto-redock again.
    const unsubscribeRegistry = floatingWindowRegistry.subscribe(() => {
      const liveIds = new Set(floatingWindowRegistry.list().map((e) => e.viewId));
      for (const viewId of Array.from(everSawBelow)) {
        if (!liveIds.has(viewId)) everSawBelow.delete(viewId);
      }
    });

    return () => {
      unsubscribed = true;
      if (settleTimer) clearTimeout(settleTimer);
      if (unlisten) unlisten();
      unsubscribeRegistry();
    };
  }, []);

  return { overlayViewId };
}
