"use client";

import React from "react";
import { Minus, Square, X, Copy, PanelRight, PanelLeft, PanelBottom, Zap } from "lucide-react";
import { useFiles } from "@/context/FilesContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useUI } from "@/context/UIContext";
import { useL10n } from "@/hooks/useL10n";
import { useTauriWindow } from "@/hooks/useTauriWindow";
import logoWhite from "@/assets/branding/logo-white.png";

const TitleBar: React.FC = () => {
  const { currentFile } = useFiles();
  const { rootPath } = useWorkspace();
  const { isRightPanelOpen, setRightPanelOpen, isSidebarOpen, setSidebarOpen, isBottomPanelOpen, setBottomPanelOpen, isZenMode, toggleZenMode } = useUI();
  const { isMaximized, minimize, toggleMaximize, close } = useTauriWindow();
  const { t } = useL10n();

  // Build dynamic title: <project> (file) | <app title>
  const buildTitle = () => {
    const project = rootPath ? (rootPath.split(/[\\/]/).pop() || rootPath) : "";
    const file = currentFile ? (currentFile.isModified ? `● ${currentFile.name}` : currentFile.name) : "";
    const appName = `${t('welcome.title')} IDE`;

    if (project && file) return `${project} (${file}) | ${appName}`;
    if (project) return `${project} | ${appName}`;
    if (file) return `(${file}) | ${appName}`;
    return appName;
  };

  return (
    <div className="relative h-[32px] bg-surface-0 flex items-center shrink-0 select-none border-b border-border-subtle z-titlebar">
      {/* Centered Title (Absolute Layer) */}
      <div
        data-tauri-drag-region
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <span className="text-caption text-muted-fg font-normal tracking-wide truncate max-w-[60vw]">
          {buildTitle()}
        </span>
      </div>

      {/* App icon + Left controls */}
      <div
        data-tauri-drag-region
        className="flex-1 flex items-center h-full px-3 gap-3"
      >
        <div data-tauri-no-drag className="flex items-center gap-3">
          {/* Logo */}
          <div className="w-5 h-5 shrink-0 flex items-center justify-center pt-0.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoWhite.src} alt="Trixty Logo" className="w-4 h-4 object-contain brightness-100" />
          </div>
        </div>
      </div>

      {/* Window controls — explicitly opt-out of drag region so clicks reach React */}
      <div data-tauri-no-drag className="flex items-center h-full">
        {/* Layout Controls */}
        <div className="flex items-center gap-1 px-3">
          <button
            onClick={() => setSidebarOpen(!isSidebarOpen)}
            aria-label={t('titlebar.layout.left')}
            className={`w-[26px] h-[26px] rounded flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
              isSidebarOpen ? "bg-white/10 text-white" : "text-muted-fg hover:bg-white/10 hover:text-white"
            }`}
            title={t('titlebar.layout.left')}
          >
            <PanelLeft size={14} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => setBottomPanelOpen(!isBottomPanelOpen)}
            aria-label={t('titlebar.layout.bottom')}
            className={`w-[26px] h-[26px] rounded flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
              isBottomPanelOpen ? "bg-white/10 text-white" : "text-muted-fg hover:bg-white/10 hover:text-white"
            }`}
            title={t('titlebar.layout.bottom')}
          >
            <PanelBottom size={14} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => setRightPanelOpen(!isRightPanelOpen)}
            aria-label={t('titlebar.layout.right')}
            className={`w-[26px] h-[26px] rounded flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
              isRightPanelOpen ? "bg-white/10 text-white" : "text-muted-fg hover:bg-white/10 hover:text-white"
            }`}
            title={t('titlebar.layout.right')}
          >
            <PanelRight size={14} strokeWidth={1.5} />
          </button>
          
          <div aria-hidden="true" className="w-[1px] h-[14px] bg-border-subtle mx-1" />

          <button
            onClick={toggleZenMode}
            aria-label={isZenMode ? t('titlebar.layout.zen_exit') : t('titlebar.layout.zen_enter')}
            className={`w-[26px] h-[26px] rounded flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
              isZenMode ? "bg-[#3b82f6]/15 text-[#3b82f6]" : "text-muted-fg hover:bg-white/10 hover:text-white"
            }`}
            title={isZenMode ? t('titlebar.layout.zen_exit') : t('titlebar.layout.zen_enter')}
          >
            <Zap size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div aria-hidden="true" className="w-[1px] h-[14px] bg-border-subtle" />
        <button
          onClick={minimize}
          aria-label={t('window.minimize')}
          className="h-full w-[46px] flex items-center justify-center text-muted-fg hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40"
          title={t('window.minimize')}
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>

        <button
          onClick={toggleMaximize}
          aria-label={isMaximized ? t('window.restore') : t('window.maximize')}
          className="h-full w-[46px] flex items-center justify-center text-muted-fg hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40"
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
          className="h-full w-[46px] flex items-center justify-center text-muted-fg hover:bg-[#e81123] hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40"
          title={t('window.close')}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
