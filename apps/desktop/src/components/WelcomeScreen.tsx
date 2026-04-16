"use client";

import React from "react";
import { Plus, FolderOpen, Search, Command, BookOpen, Terminal } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";
import logoWhite from "@/assets/branding/logo-white.png";

const WelcomeScreen: React.FC = () => {
  const { handleOpenFolder, setRightPanelOpen, setActiveSidebarTab, setSidebarOpen, setBottomPanelOpen } = useApp();
  const { t } = useL10n();
  const shortcuts = [
    { label: t('welcome.shortcut.new_project'), keys: ["Ctrl", "Alt", "N"], icon: Plus, action: () => { } },
    { label: t('welcome.shortcut.open_folder'), keys: ["Ctrl", "O"], icon: FolderOpen, action: handleOpenFolder },
    { label: t('welcome.shortcut.terminal'), keys: ["Ctrl", "J"], icon: Terminal, action: () => setBottomPanelOpen(true) },
  ];

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-[#0e0e0e] text-[#666]">
      <div className="mb-12 flex flex-col items-center">
        <div className="w-24 h-24  flex items-center justify-center mb-6">
          <img src={logoWhite.src} alt="Trixty Logo" className="w-14 h-14 object-contain" />
        </div>
        <h1 className="text-3xl font-semibold text-white mb-2 tracking-tight">{t('welcome.title')}</h1>
        <p className="text-[13px] text-[#555]">{t('welcome.subtitle')}</p>
      </div>

      <div className="w-full max-w-sm space-y-1">
        {shortcuts.map((s, i) => (
          <div
            key={i}
            onClick={s.action}
            className="flex items-center justify-between p-3 rounded-xl hover:bg-white/[0.04] transition-all border border-transparent hover:border-[#1e1e1e] group cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <s.icon size={16} className="text-[#444] group-hover:text-white/70" />
              <span className="text-[13px] text-[#777] group-hover:text-white">{s.label}</span>
            </div>
            <div className="flex gap-1">
              {s.keys.map((k, j) => (
                <kbd key={j} className="px-1.5 py-0.5 min-w-[20px] text-center bg-[#1a1a1a] text-[10px] rounded border border-[#222] text-[#555] font-mono">
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
};

export default WelcomeScreen;
