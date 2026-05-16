"use client";

import React from "react";
import { ChevronsRight, X } from "lucide-react";
import { useL10n } from "@/hooks/useL10n";
import { logger } from "@/lib/logger";

interface Props {
  viewId: string;
  title: string;
  icon?: React.ReactNode;
}

const FloatingTitleBar: React.FC<Props> = ({ viewId, title, icon }) => {
  const { t } = useL10n();

  const onDockBack = async () => {
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("floating-window:redock-request", { viewId });
    } catch (err) {
      logger.warn("[floating] dock-back emit failed:", err);
    }
  };

  const onClose = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (err) {
      logger.warn("[floating] close failed:", err);
    }
  };

  return (
    <div className="relative h-[32px] bg-surface-0 flex items-center shrink-0 select-none border-b border-border-subtle z-titlebar">
      <div
        data-tauri-drag-region
        className="flex-1 flex items-center h-full px-3 gap-2"
      >
        {icon ? (
          <span aria-hidden="true" className="shrink-0 flex items-center">
            {icon}
          </span>
        ) : null}
        <span className="text-caption text-muted-fg font-normal tracking-wide truncate">
          {t(title)}
        </span>
      </div>

      <div data-tauri-no-drag className="flex items-center h-full">
        <button
          onClick={onDockBack}
          aria-label={t("panel.view.dock_back")}
          title={t("panel.view.dock_back")}
          className="h-full px-3 flex items-center justify-center text-muted-fg hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40 gap-1.5"
        >
          <ChevronsRight size={14} strokeWidth={1.5} />
          <span className="text-[11px]">{t("panel.view.dock_back")}</span>
        </button>
        <button
          onClick={onClose}
          aria-label={t("window.close")}
          className="h-full w-[46px] flex items-center justify-center text-muted-fg hover:bg-[#e81123] hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40"
          title={t("window.close")}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
};

export default FloatingTitleBar;
