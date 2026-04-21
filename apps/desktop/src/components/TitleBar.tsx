"use client";

import React from "react";
import { Minus, Square, X, Copy, PanelRight } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";
import { useTauriWindow } from "@/hooks/useTauriWindow";
import logoWhite from "@/assets/branding/logo-white.png";

const TitleBar: React.FC = () => {
  const { currentFile, rootPath, isRightPanelOpen, setRightPanelOpen } = useApp();
  const { isMaximized, minimize, toggleMaximize, close } = useTauriWindow();
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

  return (
    <div className="h-[32px] bg-[#0a0a0a] flex items-center shrink-0 select-none border-b border-[#1a1a1a] z-999">
      {/* App icon + Drag region with title */}
      <div
        data-tauri-drag-region
        className="flex-1 flex items-center h-full px-3 gap-3"
      >
        {/* Logo */}
        <div className="w-5 h-5 shrink-0 flex items-center justify-center pt-0.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
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
          aria-label={t('panel.right.toggle')}
          aria-pressed={isRightPanelOpen}
          className={`h-full w-[46px] flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40 ${
            isRightPanelOpen
              ? "text-white bg-white/10"
              : "text-[#777] hover:bg-white/10 hover:text-white"
          }`}
          title={t('panel.right.toggle')}
        >
          <PanelRight size={14} strokeWidth={1.5} />
        </button>

        <div aria-hidden="true" className="w-[1px] h-[14px] bg-[#222]" />
        <button
          onClick={minimize}
          aria-label={t('window.minimize')}
          className="h-full w-[46px] flex items-center justify-center text-[#777] hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40"
          title={t('window.minimize')}
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>

        <button
          onClick={toggleMaximize}
          aria-label={isMaximized ? t('window.restore') : t('window.maximize')}
          className="h-full w-[46px] flex items-center justify-center text-[#777] hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40"
          title={isMaximized ? t('window.restore') : t('window.maximize')}
        >
          {isMaximized ? (
            <Copy size={12} strokeWidth={1.5} className="transform scale-x-[-1]" />
          ) : (
            <Square size={12} strokeWidth={1.5} />
          )}
        </button>

        <button
          onClick={close}
          aria-label={t('window.close')}
          className="h-full w-[46px] flex items-center justify-center text-[#777] hover:bg-[#e81123] hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40"
          title={t('window.close')}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
