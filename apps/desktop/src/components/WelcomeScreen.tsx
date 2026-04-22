"use client";

import React from "react";
import { FolderOpen, Terminal } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";
import logoWhite from "@/assets/branding/logo-white.png";

const WelcomeScreen: React.FC = () => {
  const { handleOpenFolder, setBottomPanelOpen } = useApp();
  const { t } = useL10n();
  const shortcuts = [
    //{ label: t('welcome.shortcut.new_project'), keys: ["Ctrl", "Alt", "N"], icon: Plus, action: () => { } },
    { label: t('welcome.shortcut.open_folder'), keys: ["Ctrl", "O"], icon: FolderOpen, action: handleOpenFolder },
    { label: t('welcome.shortcut.terminal'), keys: ["Ctrl", "J"], icon: Terminal, action: () => setBottomPanelOpen(true) },
  ];

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-surface-1 text-[#666]">
      <div className="mb-12 flex flex-col items-center">
        <div className="w-24 h-24  flex items-center justify-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoWhite.src} alt="Trixty Logo" className="w-14 h-14 object-contain" />
        </div>
        <h1 className="text-3xl font-semibold text-white mb-2 tracking-tight">{t('welcome.title')}</h1>
        <p className="text-ui text-subtle-fg">{t('welcome.subtitle')}</p>
      </div>

      <div className="w-full max-w-sm space-y-1">
        {shortcuts.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={s.action}
            className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/[0.04] transition-all border border-transparent hover:border-[#1e1e1e] group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <div className="flex items-center gap-3">
              <s.icon size={16} className="text-[#444] group-hover:text-white/70" />
              <span className="text-ui text-muted-fg group-hover:text-white">{s.label}</span>
            </div>
            <div className="flex gap-1">
              {s.keys.map((k, j) => (
                <kbd key={j} className="px-1.5 py-0.5 min-w-[20px] text-center bg-surface-3 text-[10px] rounded border border-border-subtle text-subtle-fg font-mono">
                  {k}
                </kbd>
              ))}
            </div>
          </button>
        ))}
      </div>

    </div>
  );
};

export default WelcomeScreen;
