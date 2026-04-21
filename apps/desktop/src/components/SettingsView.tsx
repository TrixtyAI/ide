"use client";

import React, { useState, useEffect } from "react";
import {
  Languages,
  Type,
  Globe,
  Info,
  ChevronRight,
  Settings,
  Settings2,
  X,
  Copy,
  Check,
  AlertTriangle,
  Trash2,
  Plus,
  Bot,
  RefreshCw
} from "lucide-react";
import { safeInvoke as invoke } from "@/api/tauri";
import { ask } from "@tauri-apps/plugin-dialog";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";
import { logger } from "@/lib/logger";
import logoWhite from "@/assets/branding/logo-white.png";
import AgentSettings from "@/addons/builtin.agent-support/AgentSettings";

const SettingsView: React.FC = () => {
  const {
    editorSettings,
    updateEditorSettings,
    locale,
    setLocale,
    systemSettings,
    updateSystemSettings,
    isSettingsOpen,
    setSettingsOpen,
    resetApp
  } = useApp();
  const { t } = useL10n();
  const [activeCategory, setActiveCategory] = useState("general");
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [newPattern, setNewPattern] = useState("");
  const [copied, setCopied] = useState(false);
  const [systemInfo, setSystemInfo] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (isSettingsOpen && activeCategory === "about" && !systemInfo) {
      invoke("get_trixty_about_info")
        .then(setSystemInfo)
        .catch(logger.error);
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
    { id: "general", label: t('settings.general'), icon: Settings2 },
    {
      id: "agent",
      label: t('agent.title'),
      icon: Bot,
      children: [
        { id: "agent:profile", label: t('agent.tab.profile') },
        { id: "agent:manual", label: t('agent.tab.manual') },
        { id: "agent:user", label: t('agent.tab.user') },
        { id: "agent:design", label: t('agent.tab.design') },
        { id: "agent:skills", label: t('agent.tab.skills') },
        { id: "agent:documentations", label: t('agent.tab.documentations') },
        { id: "agent:memory", label: t('agent.tab.memory') },
        { id: "agent:configuration", label: t('agent.tab.configuration') },
      ]
    },
    { id: "application", label: t('settings.application'), icon: Globe },
    { id: "about", label: t('settings.about'), icon: Info },
  ];

  const toggleCategory = (id: string) => {
    setExpandedCategories(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const renderContent = () => {
    const [mainCat, subCat] = activeCategory.split(":");

    if (mainCat === "agent") {
      const currentSub = subCat || 'profile';
      return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
           <div className="mb-8">
             <h3 className="text-[14px] font-semibold text-white flex items-center gap-2">
               {t(`agent.${currentSub}.title`)}
             </h3>
             <p className="text-[12px] text-[#666] mt-1.5 leading-relaxed max-w-xl">
               {t(`agent.${currentSub}.desc`)}
             </p>
           </div>
          <AgentSettings activeTab={(currentSub as 'profile' | 'manual' | 'user' | 'skills' | 'documentations' | 'design' | 'memory' | 'configuration')} />
        </div>
      );
    }

    switch (activeCategory) {
      case "general":
        return (
          <div className="space-y-12 animate-in fade-in slide-in-from-right-4 duration-300">
            {/* Editor Font Section */}
            <section>
              <h3 className="text-[14px] font-semibold text-white mb-4 flex items-center gap-2">
                <Type size={16} strokeWidth={1.5} className="text-blue-400" />
                {t('settings.editor.title')}
              </h3>
              <div className="space-y-4 max-w-md">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="settings-editor-font-family" className="text-[11px] text-[#888] uppercase tracking-wider">{t('settings.editor.font_family')}</label>
                  <input
                    id="settings-editor-font-family"
                    type="text"
                    value={editorSettings.fontFamily}
                    onChange={(e) => updateEditorSettings({ fontFamily: e.target.value })}
                    className="bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 text-[13px] text-white focus:border-blue-500 outline-none transition-colors"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="settings-editor-font-size" className="text-[11px] text-[#888] uppercase tracking-wider">{t('settings.editor.font_size')}</label>
                    <input
                      id="settings-editor-font-size"
                      type="number"
                      value={editorSettings.fontSize}
                      onChange={(e) => updateEditorSettings({ fontSize: parseInt(e.target.value) })}
                      className="bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 text-[13px] text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="settings-editor-line-height" className="text-[11px] text-[#888] uppercase tracking-wider">{t('settings.editor.line_height')}</label>
                    <input
                      id="settings-editor-line-height"
                      type="number"
                      value={editorSettings.lineHeight}
                      onChange={(e) => updateEditorSettings({ lineHeight: parseInt(e.target.value) })}
                      className="bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 text-[13px] text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <label htmlFor="settings-editor-minimap" className="relative inline-flex items-center cursor-pointer">
                    <input
                      id="settings-editor-minimap"
                      type="checkbox"
                      checked={!!editorSettings.minimapEnabled}
                      onChange={(e) => updateEditorSettings({ minimapEnabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div aria-hidden="true" className="w-9 h-5 bg-[#2a2a2a] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[#888] after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 peer-checked:after:bg-white"></div>
                  </label>
                  <label htmlFor="settings-editor-minimap" className="text-[13px] text-[#aaa] cursor-pointer">
                    {t('settings.editor.minimap')}
                  </label>
                </div>
              </div>
            </section>

            {/* Files: Exclude Section */}
            <section>
              <div className="mb-4">
                <h3 className="text-[14px] font-semibold text-white flex items-center gap-2">
                  Files: <span className="font-bold">Exclude</span>
                </h3>
                <p className="text-[12px] text-[#666] mt-1.5 leading-relaxed max-w-xl">
                  {t('settings.general.exclude_desc')}
                </p>
              </div>

              <div className="space-y-2 max-w-2xl">
                {/* Pattern List */}
                <div className="space-y-1">
                  {(systemSettings.filesExclude || []).map((pattern, idx) => (
                    <div
                      key={`${pattern}-${idx}`}
                      className="group flex items-center justify-between px-3 py-1.5 bg-[#0a0a0a] border border-[#1a1a1a] rounded hover:border-[#333] transition-colors"
                    >
                      <span className="text-[13px] text-[#bbb] font-mono">{pattern}</span>
                      <button
                        onClick={() => {
                          const newList = systemSettings.filesExclude.filter((_, i) => i !== idx);
                          updateSystemSettings({ filesExclude: newList });
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-[#555] hover:text-red-400 transition-all"
                      >
                        <X size={14} strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add Pattern Input */}
                <div className="pt-4 flex flex-col gap-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        id="settings-files-exclude-pattern"
                        type="text"
                        value={newPattern}
                        onChange={(e) => setNewPattern(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newPattern.trim()) {
                            if (!systemSettings.filesExclude.includes(newPattern.trim())) {
                              updateSystemSettings({ filesExclude: [...systemSettings.filesExclude, newPattern.trim()] });
                              setNewPattern("");
                            }
                          }
                        }}
                        placeholder={t('settings.general.exclude_placeholder')}
                        aria-label={t('settings.general.exclude_aria_label')}
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 text-[13px] text-white focus:border-blue-500 outline-none transition-colors"
                      />
                    </div>
                    <button
                      onClick={() => {
                        if (newPattern.trim() && !systemSettings.filesExclude.includes(newPattern.trim())) {
                          updateSystemSettings({ filesExclude: [...systemSettings.filesExclude, newPattern.trim()] });
                          setNewPattern("");
                        }
                      }}
                      className="px-4 py-2 bg-[#007acc] hover:bg-[#0062a3] text-white text-[12px] font-semibold rounded transition-colors flex items-center gap-2"
                    >
                      <Plus size={14} strokeWidth={1.5} />
                      {t('settings.general.exclude_add_pattern')}
                    </button>
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
                  <label htmlFor="settings-app-locale" className="text-[11px] text-[#888] uppercase tracking-wider">{t('settings.application.display_language')}</label>
                  <select
                    id="settings-app-locale"
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

            <section className="pt-8 mt-8 border-t border-red-500/20">
              <h3 className="text-[14px] font-semibold text-red-500 mb-2 flex items-center gap-2">
                <AlertTriangle size={16} />
                {t('settings.application.danger_zone')}
              </h3>
              <p className="text-[12px] text-[#666] mb-4 max-w-md leading-relaxed">
                {t('settings.application.reset_desc')}
              </p>

              <button
                onClick={async () => {
                  const confirmed = await ask(t('settings.application.reset_confirm'), {
                    title: t('settings.application.danger_zone'),
                    kind: 'warning',
                  });

                  if (confirmed) {
                    await resetApp();
                    setSettingsOpen(false);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 active:bg-red-500/30 border border-red-500/20 rounded-lg text-[12px] font-semibold transition-all shadow-sm group"
              >
                <Trash2 size={14} strokeWidth={1.5} className="group-hover:scale-110 transition-transform" />
                {t('settings.application.reset_button')}
              </button>
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
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logoWhite.src} alt="Trixty Logo" className="w-8 h-8 object-contain" />
                  </div>
                  <div>
                    <h4 className="text-[18px] font-bold text-white tracking-tight">Trixty</h4>
                    <p className="text-[12px] text-[#555] font-mono mt-0.5">v{systemInfo?.app_version || "---"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setSettingsOpen(false);
                      window.dispatchEvent(new Event("trixty-manual-update-check"));
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 text-[#888] hover:bg-white/10 hover:text-white border border-white/5 rounded-xl text-[11px] font-medium transition-all active:scale-95 shadow-sm"
                  >
                    <RefreshCw size={12} strokeWidth={1.5} />
                    {t('settings.application.check_updates')}
                  </button>
                  <button
                    onClick={copyAboutInfo}
                    disabled={!systemInfo}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-medium transition-all ${copied ? "bg-green-500/10 text-green-400" : "bg-white/5 text-[#888] hover:bg-white/10 hover:text-white border border-white/5"
                      } disabled:opacity-30`}
                  >
                    {copied ? <Check size={12} strokeWidth={1.5} /> : <Copy size={12} strokeWidth={1.5} />}
                    {copied ? t('settings.application.about.copy_success') : t('settings.application.about.copy_button')}
                  </button>
                </div>
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
            {categories.map((cat) => {
              const [activeMain] = activeCategory.split(":");
              const isActive = activeMain === cat.id;
              const isExpanded = expandedCategories.includes(cat.id);
              const hasChildren = cat.children && cat.children.length > 0;

              return (
                <div key={cat.id} className="space-y-1">
                  <button
                    onClick={() => {
                      if (hasChildren) {
                        toggleCategory(cat.id);
                        if (!isActive) setActiveCategory(cat.children![0].id);
                      } else {
                        setActiveCategory(cat.id);
                      }
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all group ${
                      isActive && !hasChildren
                        ? "bg-blue-500/10 text-blue-400 shadow-[inset_0_0_10px_rgba(59,130,246,0.1)]"
                        : "text-[#888] hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <cat.icon size={14} strokeWidth={1.5} className={`${isActive ? "text-blue-400" : "text-[#555] group-hover:text-[#888]"}`} />
                    {cat.label}
                    {hasChildren && (
                      <ChevronRight
                        size={12}
                        strokeWidth={1.5}
                        className={`ml-auto transition-transform duration-200 ${isExpanded ? "rotate-90 text-blue-400" : "opacity-50"}`}
                      />
                    )}
                  </button>

                  {hasChildren && isExpanded && (
                    <div className="space-y-1 ml-4 border-l border-[#1a1a1a] pl-2 animate-in slide-in-from-top-1 duration-200">
                      {cat.children!.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => setActiveCategory(child.id)}
                          className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${
                            activeCategory === child.id
                              ? "text-blue-400 bg-blue-500/5"
                              : "text-[#666] hover:text-white hover:bg-white/5"
                          }`}
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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
