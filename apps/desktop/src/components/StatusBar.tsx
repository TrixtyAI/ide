"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { GitBranch, Wifi, Bell, Cloud, LayoutTemplate, Zap, ChevronDown } from "lucide-react";
import { useFiles } from "@/context/FilesContext";
import { useUI } from "@/context/UIContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useL10n } from "@/hooks/useL10n";
import { resetLayout } from "@/api/layoutReset";
import { isTauri, safeInvoke } from "@/api/tauri";
import { logger } from "@/lib/logger";

type LayoutPreset = "default" | "editor-only" | "compact";

// StatusBar items are informational surfaces today (no click handlers). The
// previous `cursor-pointer` + `hover:bg-blue-500` styles advertised them as
// interactive, which misleads sighted users and leaves AT users with no
// affordance. Removing those classes aligns visual intent with actual
// behaviour. When a feature lands (branch picker, cursor-position toggle,
// language switcher, notifications panel), the corresponding item should be
// converted to a proper `<button>` at that point.
const StatusBar: React.FC = () => {
  const { currentFile } = useFiles();
  const {
    isZenMode,
    toggleZenMode,
    setSidebarOpen,
    setRightPanelOpen,
    setBottomPanelOpen,
  } = useUI();
  const { rootPath } = useWorkspace();
  const { t } = useL10n();
  const [branch, setBranch] = useState<string | null>(null);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const presetMenuRef = useRef<HTMLDivElement | null>(null);

  // Fetch the active git branch whenever the workspace root changes. The
  // command is best-effort — if the folder is not a git repo we surface
  // nothing (the GitBranch chip hides itself).
  useEffect(() => {
    if (!rootPath || !isTauri()) {
      setBranch(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await safeInvoke(
          "get_git_branches",
          { path: rootPath },
          { silent: true },
        );
        if (cancelled) return;
        setBranch(result.current || null);
      } catch {
        if (!cancelled) setBranch(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  // Close the preset menu when clicking outside.
  useEffect(() => {
    if (!presetMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (presetMenuRef.current && !presetMenuRef.current.contains(e.target as Node)) {
        setPresetMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [presetMenuOpen]);

  const applyPreset = useCallback(
    (preset: LayoutPreset) => {
      switch (preset) {
        case "default":
          setSidebarOpen(true);
          setRightPanelOpen(true);
          setBottomPanelOpen(false);
          break;
        case "editor-only":
          setSidebarOpen(false);
          setRightPanelOpen(false);
          setBottomPanelOpen(false);
          break;
        case "compact":
          setSidebarOpen(false);
          setRightPanelOpen(true);
          setBottomPanelOpen(false);
          break;
      }
      setPresetMenuOpen(false);
    },
    [setSidebarOpen, setRightPanelOpen, setBottomPanelOpen],
  );

  const handleResetLayout = useCallback(async () => {
    let confirmed = false;
    if (isTauri()) {
      try {
        const { ask } = await import("@tauri-apps/plugin-dialog");
        confirmed = await ask(
          "Reset panel sizes, open/closed flags, and detached views to defaults? Workspace, settings, and chat history are not touched.",
          { title: "Reset Layout?", kind: "warning" },
        );
      } catch (err) {
        logger.warn("[StatusBar] reset confirm failed:", err);
        return;
      }
    } else if (typeof window !== "undefined") {
      confirmed = window.confirm(
        "Reset layout to defaults? Workspace and settings are unchanged.",
      );
    }
    if (!confirmed) return;
    await resetLayout();
    if (typeof window !== "undefined") window.location.reload();
  }, []);

  return (
    <div className="h-[22px] bg-[#0a0a0a] text-[#999] border-t border-[#1a1a1a] flex items-center justify-between px-3 text-[11px] select-none z-50">
      <div className="flex items-center gap-3 h-full">
        {branch && (
          <div
            className="flex items-center gap-1 px-1.5 h-full"
            title={`Git branch: ${branch}`}
          >
            <GitBranch size={12} strokeWidth={1.5} />
            <span className="truncate max-w-[180px]">{branch}</span>
          </div>
        )}
        <div ref={presetMenuRef} className="relative h-full">
          <button
            type="button"
            onClick={() => setPresetMenuOpen((v) => !v)}
            title="Layout presets"
            className="flex items-center gap-1 px-1.5 h-full hover:bg-white/5 hover:text-[#ccc] transition-colors"
            aria-haspopup="menu"
            aria-expanded={presetMenuOpen}
          >
            <LayoutTemplate size={12} strokeWidth={1.5} />
            <ChevronDown size={10} strokeWidth={1.5} />
          </button>
          {presetMenuOpen && (
            <div
              role="menu"
              className="absolute bottom-full left-0 mb-1 w-44 bg-[#1e1e1e] border border-[#2b2b2b] rounded-md shadow-2xl text-[11px] text-[#ccc] overflow-hidden z-50"
            >
              <button
                type="button"
                onClick={() => applyPreset("default")}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 transition-colors"
              >
                Default (sidebar + AI)
              </button>
              <button
                type="button"
                onClick={() => applyPreset("compact")}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 transition-colors"
              >
                Compact (AI only)
              </button>
              <button
                type="button"
                onClick={() => applyPreset("editor-only")}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 transition-colors"
              >
                Editor-only
              </button>
              <div className="border-t border-[#2b2b2b]" />
              <button
                type="button"
                onClick={() => {
                  setPresetMenuOpen(false);
                  void handleResetLayout();
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 transition-colors text-amber-300/90"
              >
                Reset layout…
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 h-full">
        {currentFile && (
          <>
            <div className="px-1.5 h-full flex items-center">
              {t('status.cursor_pos', { line: "1", col: "1" })}
            </div>
            <div className="px-1.5 h-full flex items-center">
              {t('status.indentation', { count: "2" })}
            </div>
            <div className="px-1.5 h-full flex items-center uppercase">
              {currentFile.language}
            </div>
          </>
        )}
        <div className="flex items-center gap-1 px-1.5 h-full">
          <Cloud size={12} strokeWidth={1.5} />
          <span>{t('status.powered_by', { engine: 'Rust' })}</span>
        </div>
        <div className="flex items-center gap-1 px-1.5 h-full">
          <Wifi size={12} strokeWidth={1.5} />
        </div>
        <div className="flex items-center gap-1 px-1.5 h-full">
          <Bell size={12} strokeWidth={1.5} />
        </div>
        <button
          type="button"
          onClick={toggleZenMode}
          title={isZenMode ? "Exit Zen Mode (Esc)" : "Enter Zen Mode (Ctrl+K Z)"}
          className={`flex items-center gap-1 px-1.5 h-full transition-colors ${
            isZenMode
              ? "bg-[#3b82f6]/15 text-[#3b82f6]"
              : "hover:bg-white/5 hover:text-[#ccc]"
          }`}
        >
          <Zap size={12} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
};

export default StatusBar;
