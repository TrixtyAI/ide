"use client";

import React, { useState, useEffect } from "react";
import {
  Languages,
  Type,
  Palette,
  Globe,
  Info,
  ChevronRight,
  Settings,
  X,
  Copy,
  Check
} from "lucide-react";
import { safeInvoke as invoke } from "@/api/tauri";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";
import logoWhite from "@/assets/branding/logo-white.png";

const SettingsView: React.FC = () => {
  const {
    aiSettings,
    updateAISettings,
    editorSettings,
    updateEditorSettings,
    locale,
    setLocale,
    isSettingsOpen,
    setSettingsOpen
  } = useApp();
  const { t } = useL10n();
  const [activeCategory, setActiveCategory] = useState("appearance");
  const [copied, setCopied] = useState(false);
  const [systemInfo, setSystemInfo] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (isSettingsOpen && activeCategory === "about" && !systemInfo) {
      invoke("get_trixty_about_info")
        .then(setSystemInfo)
        .catch(console.error);
    }
  }, [isSettingsOpen, activeCategory, systemInfo]);

  const copyAboutInfo = () => {
    if (!systemInfo) return;
    const info = `
Trixty IDE: ${systemInfo.app_version}
Tauri: ${systemInfo.tauri_version}
WebView2: ${systemInfo.webview_version}
OS: ${systemInfo.os_name} ${systemInfo.os_version} ${systemInfo.arch}
Rust: ${systemInfo.rust_version}
Node.js: ${systemInfo.node_version}
    `.trim();
    navigator.clipboard.writeText(info);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isSettingsOpen) return null;

  const categories = [
    { id: "appearance", label: t('settings.appearance'), icon: Palette },
    { id: "application", label: t('settings.application'), icon: Globe },
    { id: "about", label: t('settings.about'), icon: Info },
  ];

  const renderContent = () => {
    switch (activeCategory) {
      case "appearance":
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <section>
              <h3 className="text-[14px] font-semibold text-white mb-4 flex items-center gap-2">
                <Type size={16} className="text-blue-400" />
                {t('settings.editor.title')}
              </h3>
              <div className="space-y-4 max-w-md">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] text-[#888] uppercase tracking-wider">{t('settings.editor.font_family')}</label>
                  <input
                    type="text"
                    value={editorSettings.fontFamily}
                    onChange={(e) => updateEditorSettings({ fontFamily: e.target.value })}
                    className="bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 text-[13px] text-white focus:border-blue-500 outline-none transition-colors"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] text-[#888] uppercase tracking-wider">{t('settings.editor.font_size')}</label>
                    <input
                      type="number"
                      value={editorSettings.fontSize}
                      onChange={(e) => updateEditorSettings({ fontSize: parseInt(e.target.value) })}
                      className="bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 text-[13px] text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] text-[#888] uppercase tracking-wider">{t('settings.editor.line_height')}</label>
                    <input
                      type="number"
                      value={editorSettings.lineHeight}
                      onChange={(e) => updateEditorSettings({ lineHeight: parseInt(e.target.value) })}
                      className="bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 text-[13px] text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>
                </div>
              </div>
            </section>
          </div>
        );
      case "application":
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <section>
              <h3 className="text-[14px] font-semibold text-white mb-4 flex items-center gap-2">
                <Languages size={16} className="text-yellow-400" />
                {t('settings.application.language_region')}
              </h3>
              <div className="space-y-4 max-w-sm">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] text-[#888] uppercase tracking-wider">{t('settings.application.display_language')}</label>
                  <select
                    value={locale}
                    onChange={(e) => setLocale(e.target.value)}
                    className="bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 text-[13px] text-white focus:border-blue-500 outline-none transition-colors appearance-none"
                  >
                    <option value="en">English</option>
                    <option value="es">Español</option>
                  </select>
                </div>
              </div>
            </section>
          </div>
        );
      case "about":
        return (
          <div className="space-y-10 max-w-3xl animate-in fade-in slide-in-from-right-4 duration-300">
            <section className="bg-transparent overflow-hidden">
              <div className="p-8 border-b border-[#1a1a1a] flex items-center justify-between">
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 bg-white/[0.03] rounded-2xl flex items-center justify-center border border-white/5">
                    <img src={logoWhite.src} alt="Trixty Logo" className="w-8 h-8 object-contain" />
                  </div>
                  <div>
                    <h4 className="text-[18px] font-bold text-white tracking-tight">Trixty</h4>
                    <p className="text-[12px] text-[#555] font-mono mt-0.5">v{systemInfo?.app_version || "---"}</p>
                  </div>
                </div>
                <button
                  onClick={copyAboutInfo}
                  disabled={!systemInfo}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-medium transition-all ${copied ? "bg-green-500/10 text-green-400" : "bg-white/5 text-[#888] hover:bg-white/10 hover:text-white border border-white/5"
                    } disabled:opacity-30`}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? t('settings.application.about.copy_success') : t('settings.application.about.copy_button')}
                </button>
              </div>

              {!systemInfo ? (
                <div className="p-20 flex flex-col items-center justify-center gap-4">
                  <div className="w-6 h-6 border-2 border-white/10 border-t-white/60 rounded-full animate-spin" />
                  <p className="text-[11px] text-[#444] animate-pulse font-medium">{t('common.loading')}</p>
                </div>
              ) : (
                <div className="p-10 grid grid-cols-2 gap-y-8 gap-x-12">
                  <div className="space-y-1">
                    <p className="text-[10px] text-[#444] uppercase tracking-widest font-bold">{t('settings.application.about.version_title')}</p>
                    <p className="text-[12px] text-[#888] font-mono">{systemInfo.app_version}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-[#444] uppercase tracking-widest font-bold">{t('settings.application.about.os_title')}</p>
                    <p className="text-[12px] text-[#888] font-mono leading-tight">{systemInfo.os_name} {systemInfo.os_version} ({systemInfo.arch})</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-[#444] uppercase tracking-widest font-bold">{t('settings.application.about.tauri_title')}</p>
                    <p className="text-[12px] text-[#888] font-mono">{systemInfo.tauri_version}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-[#444] uppercase tracking-widest font-bold">{t('settings.application.about.webview_title')}</p>
                    <p className="text-[12px] text-[#888] font-mono">{systemInfo.webview_version}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-[#444] uppercase tracking-widest font-bold">{t('settings.application.about.rust_title')}</p>
                    <p className="text-[12px] text-[#888] font-mono">{systemInfo.rust_version}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-[#444] uppercase tracking-widest font-bold">Node.js</p>
                    <p className="text-[12px] text-[#888] font-mono">{systemInfo.node_version}</p>
                  </div>
                </div>
              )}
            </section>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 md:p-12 animate-in fade-in duration-300"
      onKeyDown={(e) => e.key === "Escape" && setSettingsOpen(false)}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={() => setSettingsOpen(false)}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-5xl h-full max-h-[85vh] bg-[#0e0e0e] border border-[#1a1a1a] rounded-2xl shadow-2xl flex overflow-hidden animate-in zoom-in-95 duration-300">
        {/* Sidebar Navigation */}
        <div className="w-[200px] border-r border-[#1a1a1a] bg-[#0c0c0c] flex flex-col py-6 shrink-0">
          <div className="px-6 mb-8">
            <h2 className="text-[18px] font-bold text-white tracking-tight flex items-center gap-2">
              <Settings className="text-blue-500" size={20} />
              {t('settings.title')}
            </h2>
          </div>
          <nav className="flex-1 space-y-1 px-3">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all group ${activeCategory === cat.id
                  ? "bg-blue-500/10 text-blue-400 shadow-[inset_0_0_10px_rgba(59,130,246,0.1)]"
                  : "text-[#888] hover:text-white hover:bg-white/5"
                  }`}
              >
                <cat.icon size={16} className={`${activeCategory === cat.id ? "text-blue-400" : "text-[#555] group-hover:text-[#888]"}`} />
                {cat.label}
                {activeCategory === cat.id && (
                  <ChevronRight size={14} className="ml-auto opacity-50" />
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-auto bg-[#0e0e0e] scrollbar-thin scrollbar-thumb-[#2a2a2a] scrollbar-track-transparent">
          <div className="max-w-3xl mx-auto px-12 py-12 pb-24 relative">
            {/* Close Button Top Right */}
            <button
              onClick={() => setSettingsOpen(false)}
              className="absolute top-8 right-8 text-[#555] hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsView;
