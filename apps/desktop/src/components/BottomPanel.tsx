"use client";

import React, { useState } from "react";
import Terminal from "./Terminal";
import { X, Terminal as TerminalIcon } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";

const BottomPanel: React.FC = () => {
  const { setBottomPanelOpen } = useApp();
  const { t } = useL10n();
  const [activeTab, setActiveTab] = useState("terminal");

  const tabs = [
    { id: "terminal", label: t('panel.bottom.terminal'), icon: TerminalIcon },
  ];

  return (
    <div className="h-full bg-[#0e0e0e] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 h-[36px] bg-[#0a0a0a] shrink-0 border-t border-[#1a1a1a]">
        <div className="flex gap-4 h-full">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`text-[11px] font-medium h-full border-b transition-colors uppercase tracking-wider flex items-center gap-1.5 ${activeTab === tab.id
                ? "border-white text-white"
                : "border-transparent text-[#555] hover:text-white/70"
                }`}
            >
              <tab.icon size={14} strokeWidth={1.5} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 text-[#555]">
          <button
            onClick={() => setBottomPanelOpen(false)}
            className="hover:text-white p-1 rounded hover:bg-white/5 transition-colors"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-[#0e0e0e] overflow-hidden relative">
        <div className={`h-full ${activeTab === "terminal" ? "block" : "hidden"}`}>
          <Terminal />
        </div>
      </div>
    </div>
  );
};

export default BottomPanel;
