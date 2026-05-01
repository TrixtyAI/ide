"use client";

import React, { useEffect, useState } from "react";
import { GitBranch, Users } from "lucide-react";
import { useFiles } from "@/context/FilesContext";
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

  const { rootPath } = useWorkspace();
  const { t } = useL10n();
  const { isCollaborating, activeUsers, role, provider } = useCollaboration();
  const [branch, setBranch] = useState<string | null>(null);

  // Fetch the active git branch whenever the workspace root changes. The
  // command is best-effort — if the folder is not a git repo we surface
  // nothing (the GitBranch chip hides itself).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!rootPath || !isTauri()) {
        if (!cancelled) setBranch(null);
        return;
      }
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
            className="flex items-center gap-1.5 px-1.5 h-full text-indigo-400 border-x border-white/5 bg-indigo-500/5 group relative"
          >
            <Users size={12} strokeWidth={1.5} />
            <span className="font-medium">{activeUsers.length}</span>

            {/* Collaborators Hover List */}
            <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block w-48 bg-[#0e0e0e] border border-[#1a1a1a] rounded-lg shadow-2xl p-2 animate-in slide-in-from-bottom-1 duration-200 z-[100]">
              <div className="text-[10px] text-[#555] uppercase tracking-wider mb-2 px-1">Collaborators</div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-white/5 transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                  <span className="text-[11px] text-white">You ({role === 'host' ? 'Host' : 'Guest'})</span>
                </div>
                {activeUsers
                  .filter(u => u.user && u.user.clientId !== (provider?.awareness?.clientID))
                  .map((u, i) => (
                    <div key={i} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-white/5 transition-colors">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: u.user?.color }} />
                      <span className="text-[11px] text-[#bbb]">{u.user?.name}</span>
                    </div>
                  ))}
              </div>
            </div>
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
