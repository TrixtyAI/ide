"use client";

import React from "react";
import Terminal from "./Terminal";
import { X, Terminal as TerminalIcon } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";

const BottomPanel: React.FC = () => {
  const { setBottomPanelOpen } = useApp();
  const { t } = useL10n();

  return (
    <div className="h-full bg-[#0e0e0e] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 h-[36px] bg-[#0a0a0a] shrink-0 border-t border-[#1a1a1a]">
        <div className="flex gap-4 h-full">
          <div className="text-[11px] font-medium h-full border-b border-white text-white uppercase tracking-wider flex items-center gap-1.5">
            <TerminalIcon size={14} strokeWidth={1.5} />
            {t('panel.bottom.terminal')}
          </div>
        </div>

        <div className="flex items-center gap-1 text-[#555]">
          <button
            onClick={() => setBottomPanelOpen(false)}
            aria-label={t('panel.bottom.close', { defaultValue: 'Close bottom panel' })}
            className="hover:text-white p-1 rounded hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-[#0e0e0e] overflow-hidden relative">
        <Terminal />
      </div>
    </div>
  );
};

export default BottomPanel;
