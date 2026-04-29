"use client";

import React, { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { trixty, type WebviewView } from "@/api/trixty";
import FloatingTitleBar from "@/components/FloatingTitleBar";
import { useL10n } from "@/hooks/useL10n";
import { logger } from "@/lib/logger";
import { isTauri } from "@/api/tauri";
import { PluginManager } from "@/api/PluginManager";

// Each Tauri WebviewWindow has its own JS realm, so the `trixty.window`
// registry in this window starts empty. Without bootstrapping built-ins
// here the requested view is never registered and the body is stuck on
// the "loading" state. External addons stay disabled — the main window
// already owns their lifecycle, and we do not want duplicate sandbox
// workers or approval prompts surfacing in an auxiliary window.
let floatBootstrapStarted = false;
function ensureFloatBootstrap(): void {
  if (floatBootstrapStarted) return;
  floatBootstrapStarted = true;
  void PluginManager.bootstrap({ skipExternalAddons: true });
}

function useRegisteredView(viewId: string | null): WebviewView | null {
  const subscribe = (listener: () => void) =>
    viewId ? trixty.window.subscribe(listener) : () => undefined;
  const getSnapshot = () => {
    if (!viewId) return null;
    const all = [
      ...trixty.window.getRightPanelViews(),
      ...trixty.window.getLeftPanelViews(),
    ];
    return all.find((v) => v.id === viewId) ?? null;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function LoadingShell() {
  return (
    <div className="h-screen flex items-center justify-center text-[#666] text-[12px]">
      …
    </div>
  );
}

function FloatingViewBody() {
  const params = useSearchParams();
  const viewId = params.get("view");
  const view = useRegisteredView(viewId);
  const { t } = useL10n();
  const [bootError, setBootError] = useState<string | null>(null);

  // Bootstrap built-in addons after commit. Calling it during render would
  // synchronously fire `L10nRegistry.notify()` → other useSyncExternalStore
  // subscribers (e.g. HtmlLangSync) would setState during another component's
  // render and React 18 throws "Cannot update a component while rendering a
  // different component". The effect path defers the work to the
  // commit-phase, so the first paint shows the loading state and the next
  // commit wakes up the registry subscribers cleanly.
  useEffect(() => {
    ensureFloatBootstrap();
  }, []);

  // Broadcast our outer rect on every move so the main window can compute
  // overlap and decide when to show its drop zone.
  useEffect(() => {
    if (!viewId || !isTauri()) return;
    let unsubscribed = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const [{ getCurrentWindow }, { emit }] = await Promise.all([
          import("@tauri-apps/api/window"),
          import("@tauri-apps/api/event"),
        ]);
        const win = getCurrentWindow();
        const broadcast = async () => {
          try {
            const pos = await win.outerPosition();
            const size = await win.outerSize();
            await emit("floating-window:moved", {
              viewId,
              x: pos.x,
              y: pos.y,
              w: size.width,
              h: size.height,
            });
          } catch (err) {
            logger.debug("[floating] move broadcast failed:", err);
          }
        };
        await broadcast();
        const handle = await win.onMoved(broadcast);
        if (unsubscribed) handle();
        else unlisten = handle;
      } catch (err) {
        logger.warn("[floating] move-listener init failed:", err);
        setBootError(String(err));
      }
    })();

    return () => {
      unsubscribed = true;
      if (unlisten) unlisten();
    };
  }, [viewId]);

  // Intercept close (X) to announce intent before tearing down.
  useEffect(() => {
    if (!viewId || !isTauri()) return;
    let unsubscribed = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const [{ getCurrentWindow }, { emit }] = await Promise.all([
          import("@tauri-apps/api/window"),
          import("@tauri-apps/api/event"),
        ]);
        const win = getCurrentWindow();
        const handle = await win.onCloseRequested(async (event) => {
          event.preventDefault();
          try {
            await emit("floating-window:closed", { viewId });
          } catch (err) {
            logger.warn("[floating] close emit failed:", err);
          }
          try {
            await win.destroy();
          } catch (err) {
            logger.warn("[floating] destroy failed:", err);
          }
        });
        if (unsubscribed) handle();
        else unlisten = handle;
      } catch (err) {
        logger.warn("[floating] close-listener init failed:", err);
      }
    })();

    return () => {
      unsubscribed = true;
      if (unlisten) unlisten();
    };
  }, [viewId]);

  if (!viewId) {
    return (
      <div className="h-screen flex items-center justify-center text-[#666] text-[12px]">
        {t("panel.view.in_floating_window", { name: "(unknown)" })}
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="h-screen flex flex-col items-center justify-center text-red-300/90 text-[12px] gap-2 px-6 text-center">
        <span>{bootError}</span>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="h-screen flex items-center justify-center text-[#666] text-[12px]">
        {t("common.loading")}
      </div>
    );
  }

  const ViewRender = view.render;
  return (
    <div className="h-screen w-screen flex flex-col bg-surface-1">
      <FloatingTitleBar viewId={viewId} title={view.title} icon={view.icon} />
      {/* `flex-col` so children stretch to full width by default — the
          right-panel slot uses the same shape. A row-flex parent here would
          collapse views like AiChat (whose root has h-full but no explicit
          w-full / flex-1) to their content width and leave the rest of the
          window dark. */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <ViewRender />
      </div>
    </div>
  );
}

export default function FloatingViewPage() {
  // Next 16 requires `useSearchParams()` to live under a Suspense boundary so
  // the route can prerender without bailing out of CSR. The body component
  // owns the search-param read; the boundary stays at the route entry.
  return (
    <Suspense fallback={<LoadingShell />}>
      <FloatingViewBody />
    </Suspense>
  );
}
