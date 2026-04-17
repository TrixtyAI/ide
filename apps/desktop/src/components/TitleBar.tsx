"use client";

import React, { useEffect, useState } from "react";
import { Minus, Square, X, Copy, PanelRight } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";
import logoWhite from "@/assets/branding/logo-white.png";

const TitleBar: React.FC = () => {
  const { currentFile, rootPath, isRightPanelOpen, setRightPanelOpen } = useApp();
  const [isMaximized, setIsMaximized] = useState(true);
  const { t } = useL10n();

  // Build dynamic title
  const buildTitle = () => {
    const parts: string[] = [];
    if (currentFile) {
      const name = currentFile.isModified ? `● ${currentFile.name}` : currentFile.name;
      parts.push(name);
    }
    if (rootPath) {
      const folderName = rootPath.split(/[\\/]/).pop() || rootPath;
      parts.push(folderName);
    }
    parts.push("Trixty IDE");
    return parts.join(" — ");
  };

  // Check maximize state on mount and listen for changes
  useEffect(() => {
    const checkMaximized = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const maximized = await win.isMaximized();
        setIsMaximized(maximized);

        // Listen for resize events to track maximize state
        const unlisten = await win.onResized(async () => {
          const m = await win.isMaximized();
          setIsMaximized(m);
        });

        return unlisten;
      } catch {
        return undefined;
      }
    };

    let cleanup: (() => void) | undefined;
    checkMaximized().then((fn) => {
      cleanup = fn;
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch { }
  };

  const handleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().toggleMaximize();
    } catch { }
  };

  const handleClose = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch { }
  };

  return (
    <div className="h-[32px] bg-[#0a0a0a] flex items-center shrink-0 select-none border-b border-[#1a1a1a] z-999">
      {/* App icon + Drag region with title */}
      <div
        data-tauri-drag-region
        className="flex-1 flex items-center h-full px-3 gap-3"
      >
        {/* Logo */}
        <div className="w-5 h-5 shrink-0 flex items-center justify-center pt-0.5">
          <img src={logoWhite.src} alt="Trixty Logo" className="w-4 h-4 object-contain brightness-100" />
        </div>

        {/* Title */}
        <span
          className="text-[11px] text-[#777] font-normal tracking-wide truncate"
        >
          {buildTitle()}
        </span>
      </div>

      {/* Window controls — explicitly opt-out of drag region so clicks reach React */}
      <div data-tauri-no-drag className="flex items-center h-full">
        {/* Right Panel Toggle */}
        <button
          onClick={() => setRightPanelOpen(!isRightPanelOpen)}
          className={`h-full w-[46px] flex items-center justify-center transition-colors ${
            isRightPanelOpen
              ? "text-white bg-white/10"
              : "text-[#777] hover:bg-white/10 hover:text-white"
          }`}
          title={t('panel.right.toggle')}
        >
          <PanelRight size={14} strokeWidth={1.5} />
        </button>

        <div className="w-[1px] h-[14px] bg-[#222]" />
        <button
          onClick={handleMinimize}
          className="h-full w-[46px] flex items-center justify-center text-[#777] hover:bg-white/10 hover:text-white transition-colors"
          title={t('window.minimize')}
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>

        <button
          onClick={handleMaximize}
          className="h-full w-[46px] flex items-center justify-center text-[#777] hover:bg-white/10 hover:text-white transition-colors"
          title={isMaximized ? t('window.restore') : t('window.maximize')}
        >
          {isMaximized ? (
            <Copy size={12} strokeWidth={1.5} className="transform scale-x-[-1]" />
          ) : (
            <Square size={12} strokeWidth={1.5} />
          )}
        </button>

        <button
          onClick={handleClose}
          className="h-full w-[46px] flex items-center justify-center text-[#777] hover:bg-[#e81123] hover:text-white transition-colors"
          title={t('window.close')}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
