"use client";

import React from "react";
import { GitBranch, Wifi, Bell, Cloud, RefreshCw } from "lucide-react";
import { useFiles } from "@/context/FilesContext";
import { useL10n } from "@/hooks/useL10n";

// StatusBar items are informational surfaces today (no click handlers). The
// previous `cursor-pointer` + `hover:bg-blue-500` styles advertised them as
// interactive, which misleads sighted users and leaves AT users with no
// affordance. Removing those classes aligns visual intent with actual
// behaviour. When a feature lands (branch picker, cursor-position toggle,
// language switcher, notifications panel), the corresponding item should be
// converted to a proper `<button>` at that point.
const StatusBar: React.FC = () => {
  const { currentFile } = useFiles();
  const { t } = useL10n();

  return (
    <div className="h-[22px] bg-blue-600 text-white flex items-center justify-between px-3 text-[11px] select-none z-50">
      <div className="flex items-center gap-3 h-full">
        <div className="flex items-center gap-1 px-1.5 h-full">
          <GitBranch size={12} strokeWidth={1.5} />
          <span>main*</span>
        </div>
        <div className="flex items-center gap-2 px-1.5 h-full">
          <RefreshCw size={12} strokeWidth={1.5} />
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
      </div>
    </div>
  );
};

export default StatusBar;
