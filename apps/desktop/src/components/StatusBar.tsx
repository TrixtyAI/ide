"use client";

import React, { useEffect, useState } from "react";
import { GitBranch, Users } from "lucide-react";
import { useFiles } from "@/context/FilesContext";
import { useUI } from "@/context/UIContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useL10n } from "@/hooks/useL10n";
import { isTauri, safeInvoke } from "@/api/tauri";
import { useCollaboration } from "@/context/CollaborationContext";


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
    setSidebarOpen,
    setRightPanelOpen,
    setBottomPanelOpen,
  } = useUI();
  const { rootPath } = useWorkspace();
  const { t } = useL10n();
  const { isCollaborating, activeUsers } = useCollaboration();
  const [branch, setBranch] = useState<string | null>(null);

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

        {isCollaborating && (
          <div 
            className="flex items-center gap-1.5 px-1.5 h-full text-indigo-400 border-x border-white/5 bg-indigo-500/5"
            title={`${activeUsers.length + 1} users collaborating`}
          >
            <Users size={12} strokeWidth={1.5} />
            <span className="font-medium">{activeUsers.length + 1}</span>
          </div>
        )}
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
      </div>
    </div>
  );
};

export default StatusBar;
