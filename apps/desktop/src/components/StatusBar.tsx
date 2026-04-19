"use client";

import React from "react";
import { GitBranch, Wifi, Bell, Cpu, Cloud, RefreshCw } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";

const StatusBar: React.FC = () => {
  const { currentFile } = useApp();
  const { t } = useL10n();

  return (
    <div className="h-[22px] bg-blue-600 text-white flex items-center justify-between px-3 text-[11px] select-none z-50">
      <div className="flex items-center gap-3 h-full">
        <div className="flex items-center gap-1 hover:bg-blue-500 px-1.5 h-full cursor-pointer transition-colors">
          <GitBranch size={12} strokeWidth={1.5} />
          <span>main*</span>
        </div>
        <div className="flex items-center gap-2 hover:bg-blue-500 px-1.5 h-full cursor-pointer transition-colors">
          <RefreshCw size={12} strokeWidth={1.5} />
        </div>
      </div>

      <div className="flex items-center gap-3 h-full">
        {currentFile && (
          <>
            <div className="hover:bg-blue-500 px-1.5 h-full flex items-center cursor-pointer">
              {t('status.cursor_pos', { line: "1", col: "1" })}
            </div>
            <div className="hover:bg-blue-500 px-1.5 h-full flex items-center cursor-pointer">
              {t('status.indentation', { count: "2" })}
            </div>
            <div className="hover:bg-blue-500 px-1.5 h-full flex items-center cursor-pointer uppercase">
              {currentFile.language}
            </div>
          </>
        )}
        <div className="flex items-center gap-1 hover:bg-blue-500 px-1.5 h-full cursor-pointer transition-colors">
          <Cloud size={12} strokeWidth={1.5} />
          <span>{t('status.powered_by', { engine: 'Rust' })}</span>
        </div>
        <div className="flex items-center gap-1 hover:bg-blue-500 px-1.5 h-full cursor-pointer transition-colors">
          <Wifi size={12} strokeWidth={1.5} />
        </div>
        <div className="flex items-center gap-1 hover:bg-blue-500 px-1.5 h-full cursor-pointer transition-colors">
          <Bell size={12} strokeWidth={1.5} />
        </div>
      </div>
    </div>
  );
};

export default StatusBar;
