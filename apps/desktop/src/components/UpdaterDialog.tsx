"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Download, X, ArrowUpCircle, RefreshCw, CheckCircle2 } from "lucide-react";
import { safeInvoke } from "@/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";

type UpdaterState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; version: string; body: string | null }
  | { phase: "downloading"; progress: number }
  | { phase: "ready" }
  | { phase: "error"; message: string }
  | { phase: "up-to-date" };

const UpdaterDialog: React.FC = () => {
  const { systemSettings } = useApp();
  const { t } = useL10n();
  const [state, setState] = useState<UpdaterState>({ phase: "idle" });
  const [dismissed, setDismissed] = useState(false);

  const checkForUpdates = useCallback(async (isManual: boolean = false) => {
    if (isManual) {
       setState({ phase: "checking" });
       setDismissed(false);
    }
    
    try {
      let endpointUrl = "https://github.com/TrixtyAI/ide/releases/latest/download/latest.json";
      try {
        const fetchUrl = systemSettings.updateChannel === "insiders" 
          ? "https://api.github.com/repos/TrixtyAI/ide/releases" 
          : "https://api.github.com/repos/TrixtyAI/ide/releases/latest";
          
        const res = await fetch(fetchUrl);
        if (res.ok) {
          const data = await res.json();
          // If insiders, it returns an array. If stable, it returns a single release object.
          const releases = Array.isArray(data) ? data : [data];
          
          for (const release of releases) {
            const asset = release.assets?.find((a: { name: string; browser_download_url: string }) => a.name === "latest.json");
            if (asset?.browser_download_url) {
              endpointUrl = asset.browser_download_url;
              break;
            }
          }
        }
      } catch (err) {
        console.warn("[Updater] Could not fetch releases from github api. Falling back to default URL.", err);
      }

      // 2. Pass this dynamically discovered URL to our custom Rust command
      const update = await safeInvoke("check_update", { url: endpointUrl });

      if (!update) {
         if (isManual) setState({ phase: "up-to-date" });
         return;
      }

      setState({
        phase: "available",
        version: update.version,
        body: update.body ?? null,
      });

      // Maintain endpoint for installation phase
      (window as Window & typeof globalThis & { __trixty_update_url__?: string })
        .__trixty_update_url__ = endpointUrl;

    } catch (err) {
      console.warn("[Updater] Check failed:", err);
      if (isManual) setState({ phase: "error", message: "Check failed. No release exists or network error." });
    }
  }, [systemSettings.updateChannel]);

  useEffect(() => {
    const timer = setTimeout(checkForUpdates, 4000);

    const manualCheck = () => checkForUpdates(true);

    window.addEventListener("trixty-manual-update-check", manualCheck);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("trixty-manual-update-check", manualCheck);
    };
  }, [checkForUpdates, systemSettings.updateChannel]);

  const handleInstall = async () => {
    try {
      setState({ phase: "downloading", progress: 0 });

      const url = (window as Window & typeof globalThis & { __trixty_update_url__?: string })
        .__trixty_update_url__;

      if (!url) {
        setState({ phase: "error", message: "Update URL lost. Please restart the app." });
        return;
      }

      let downloaded = 0;
      let total = 0;

      // Listen for download progress from Rust
      const unlisten = await listen<{chunk_length: number, content_length: number | null}>("updater-progress", (event) => {
        downloaded += event.payload.chunk_length;
        if (event.payload.content_length) total = event.payload.content_length;
        const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
        setState({ phase: "downloading", progress: pct });
      });

      try {
        await safeInvoke("install_update", { url });
        
        setState({ phase: "ready" });
        
        // Relaunch app
        setTimeout(async () => {
            try {
              const { relaunch } = await import("@tauri-apps/plugin-process");
              await relaunch();
            } catch {
              setState({ phase: "error", message: t('updater.error.relaunch') });
            }
        }, 1500);

      } finally {
        unlisten();
      }

    } catch (err) {
      setState({ phase: "error", message: String(err) });
    }
  };

  if (state.phase === "idle" || dismissed) return null;

  const getDialogTitle = () => {
    switch (state.phase) {
      case "ready": return t('updater.installed');
      case "checking": return t('updater.title.checking');
      case "up-to-date": return t('updater.title.uptodate');
      case "error": return t('updater.title.error');
      default: return t('updater.available');
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[9999] animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="w-[340px] bg-[#111] border border-[#262626] rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.6)] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a] bg-[#0d0d0d]">
          <div className="flex items-center gap-2">
            <ArrowUpCircle size={15} className="text-blue-400" />
            <span className="text-[12px] font-semibold text-white tracking-wide">
              {getDialogTitle()}
            </span>
          </div>
          {state.phase !== "downloading" && state.phase !== "ready" && (
            <button
              onClick={() => setDismissed(true)}
              className="p-1 text-[#555] hover:text-white rounded transition-colors"
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">

          {/* Checking */}
          {state.phase === "checking" && (
            <div className="flex items-center gap-2 py-1">
              <RefreshCw size={14} className="text-[#888] animate-spin shrink-0" />
              <span className="text-[11px] text-[#888]">
                {t('updater.checking', { channel: systemSettings.updateChannel })}
              </span>
            </div>
          )}

          {/* Up to date */}
          {state.phase === "up-to-date" && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 py-1">
                <CheckCircle2 size={14} className="text-green-400 shrink-0" />
                <span className="text-[11px] text-[#888]">{t('updater.uptodate')}</span>
              </div>
              <button 
                onClick={() => setDismissed(true)} 
                className="text-[11px] text-[#555] hover:text-white pb-0.5"
              >
                {t('common.cancel')}
              </button>
            </div>
          )}

          {/* Available */}
          {state.phase === "available" && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#555]">{t('updater.new_version')}</span>
                <span className="text-[11px] font-mono font-semibold text-green-400 bg-green-400/10 border border-green-400/20 px-1.5 py-0.5 rounded-md">
                  {state.version}
                </span>
              </div>
              {state.body && (
                <p className="text-[11px] text-[#666] leading-relaxed line-clamp-3">
                  {state.body}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleInstall}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-white text-black text-[11px] font-semibold rounded-lg hover:bg-white/90 transition-all active:scale-95"
                >
                  <Download size={12} />
                  {t('updater.update_now')}
                </button>
                <button
                  onClick={() => setDismissed(true)}
                  className="px-3 py-1.5 bg-[#1a1a1a] border border-[#262626] text-[#777] text-[11px] font-medium rounded-lg hover:text-white hover:border-[#333] transition-all"
                >
                  {t('updater.later')}
                </button>
              </div>
            </>
          )}

          {/* Downloading */}
          {state.phase === "downloading" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RefreshCw size={12} className="animate-spin text-blue-400" />
                  <span className="text-[11px] text-[#888]">{t('updater.downloading')}</span>
                </div>
                <span className="text-[11px] font-mono text-blue-400">
                  {state.progress > 0 ? `${state.progress}%` : "…"}
                </span>
              </div>
              {/* Progress bar */}
              <div className="w-full h-[3px] bg-[#1a1a1a] rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-200"
                  style={{ width: state.progress > 0 ? `${state.progress}%` : "20%", animation: state.progress === 0 ? "pulse 1.5s infinite" : undefined }}
                />
              </div>
            </div>
          )}

          {/* Ready to relaunch */}
          {state.phase === "ready" && (
            <div className="flex items-center gap-2 py-1">
              <CheckCircle2 size={14} className="text-green-400 shrink-0" />
              <span className="text-[11px] text-[#888]">{t('updater.relaunching')}</span>
            </div>
          )}

          {/* Error */}
          {state.phase === "error" && (
            <div className="space-y-2">
              <p className="text-[11px] text-red-400/90 leading-relaxed">{state.message}</p>
              <button
                onClick={() => setDismissed(true)}
                className="text-[11px] text-[#555] hover:text-white transition-colors"
                aria-label="Dismiss Error"
              >
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpdaterDialog;
