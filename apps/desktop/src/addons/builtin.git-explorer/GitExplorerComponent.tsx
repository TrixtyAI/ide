"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Folder, File, ChevronRight, ChevronDown, RefreshCw, FolderOpen, Search,
  GitBranch, GitCommit, Upload, Plus, Sparkles, ChevronUp,
  FilePlus, FileX, FileEdit, Package, Terminal as TerminalIcon, Eye, Copy, ExternalLink, Settings, History, ClipboardPaste, FileCode, Trash2,
  Minus
} from "lucide-react";
import { safeInvoke as invoke } from "@/api/tauri";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";
import ContextMenu, { ContextMenuItem } from "@/components/ui/ContextMenu";
import pm from "picomatch";

interface FileEntry { name: string; path: string; is_dir: boolean; children?: FileEntry[]; }
interface SearchResult { file_path: string; file_name: string; line_number: number; content: string; }
interface GitFileChange { status: string; file: string; }

const STATUS_META: Record<string, { icon: React.ElementType; color: string }> = {
  "M": { icon: FileEdit, color: "text-yellow-400/80" },
  "A": { icon: FilePlus, color: "text-green-400/80" },
  "D": { icon: FileX, color: "text-red-400/80" },
  "??": { icon: FilePlus, color: "text-green-500/80" },
  "R": { icon: FileEdit, color: "text-blue-400/80" },
};

const GitExplorerComponent: React.FC = () => {
  const { openFile, activeSidebarTab, rootPath, setRootPath, openTerminal, currentFile, closeFile, aiSettings, systemSettings } = useApp();
  const { t } = useL10n();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [gitChanges, setGitChanges] = useState<GitFileChange[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState("");
  const [stagedChanges, setStagedChanges] = useState<GitFileChange[]>([]);
  const [commitMessage, setCommitMessage] = useState("");
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [gitLoading, setGitLoading] = useState(false);
  const [gitFeedback, setGitFeedback] = useState("");
  const [aiSuggestLoading, setAiSuggestLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const [newEntry, setNewEntry] = useState<{ parentPath: string; type: "file" | "folder" } | null>(null);
  const [newEntryName, setNewEntryName] = useState("");

  const loadDirectory = useCallback(async (path: string, parentPath?: string) => {
    setLoading(true);
    try {
      const data = await invoke("read_directory", { path });

      // Filtering logic
      const patterns = systemSettings.filesExclude || [];
      const isMatch = pm(patterns, { dot: true });

      const filtered = data.filter((entry: FileEntry) => {
        if (!rootPath) return true;

        // Match against name
        if (isMatch(entry.name)) return false;

        // Match against relative path from root
        const relPath = entry.path.replace(rootPath, "").replace(/^[\\\/]/, "").replace(/\\/g, "/");
        if (relPath && isMatch(relPath)) return false;

        return true;
      });

      const sorted = filtered.sort((a, b) => (b.is_dir ? 1 : 0) - (a.is_dir ? 1 : 0) || a.name.localeCompare(b.name));

      if (!parentPath) { setEntries(sorted); } else {
        setEntries((prev) => {
          const update = (items: FileEntry[]): FileEntry[] => items.map((i) => {
            if (i.path === path) return { ...i, children: sorted };
            if (i.children) return { ...i, children: update(i.children) };
            return i;
          });
          return update(prev);
        });
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [rootPath, systemSettings.filesExclude]);

  const handleOpenFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: t('explorer.select_folder') });
      if (selected && typeof selected === "string") { setRootPath(selected); setEntries([]); setExpandedDirs({}); loadDirectory(selected); }
    } catch (e) { console.error(e); }
  };

  useEffect(() => { if (rootPath) loadDirectory(rootPath); }, [rootPath, loadDirectory]);

  // Auto-Reveal Logic
  useEffect(() => {
    if (!currentFile || !rootPath || !currentFile.path.startsWith(rootPath)) return;

    const relativePath = currentFile.path.replace(rootPath, "");
    const parts = relativePath.split("/").filter(Boolean);

    if (parts.length > 0) {
      const newExpanded = { ...expandedDirs };
      let currentPath = rootPath;
      let changed = false;

      // We don't expand the file itself, only its parents
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath += (currentPath.endsWith("/") ? "" : "/") + parts[i];
        if (!newExpanded[currentPath]) {
          newExpanded[currentPath] = true;
          changed = true;
          // Ensure children are loaded
          loadDirectory(currentPath, currentPath);
        }
      }

      if (changed) {
        setExpandedDirs(newExpanded);
      }
    }
  }, [currentFile?.path, rootPath, loadDirectory]);

  const handleCreateEntry = async () => {
    if (!newEntry || !newEntryName.trim()) {
      setNewEntry(null);
      setNewEntryName("");
      return;
    }

    const { parentPath, type } = newEntry;
    const path = `${parentPath}/${newEntryName}`;

    try {
      if (type === "file") {
        await invoke("write_file", { path, content: "" });
        openFile(path, newEntryName, "", "file");
      } else {
        await invoke("create_directory", { path });
      }
      loadDirectory(parentPath, parentPath === rootPath ? undefined : parentPath);
    } catch (e) {
      console.error(e);
    } finally {
      setNewEntry(null);
      setNewEntryName("");
    }
  };

  // Git
  const refreshGit = useCallback(async () => {
    if (!rootPath) return;
    try {
      const status = await invoke("get_git_status", { path: rootPath }, { silent: true });
      setIsGitRepo(true);
      const lines = status.split("\n").filter((l: string) => l.trim());
      // Porcelain v1: XY filename
      // X = staged status, Y = unstaged status
      const staged: GitFileChange[] = [];
      const unstaged: GitFileChange[] = [];
      for (const l of lines) {
        const x = l[0]; // staged
        const y = l[1]; // unstaged
        const file = l.substring(3).trim();
        if (x !== " " && x !== "?") staged.push({ status: x, file });
        if (y !== " " && y !== "?") unstaged.push({ status: y, file });
        // Untracked files (??) go to unstaged
        if (x === "?" && y === "?") unstaged.push({ status: "??", file });
      }
      setStagedChanges(staged);
      setGitChanges(unstaged);
      const bl = await invoke("get_git_branches", { path: rootPath });
      setBranches(bl);
      if (bl.length > 0) setCurrentBranch(bl[0]);
    } catch (err) {
      const errStr = String(err).toLowerCase();
      const isNotGitRepoError =
        errStr.includes("not a git repository") ||
        errStr.includes("must be run in a work tree");
      if (errStr.includes("dubious ownership")) {
        const shouldFix = window.confirm(
          `${t('git.explorer.safe_dir_title')}\n\n${t('git.explorer.safe_dir_desc', { path: rootPath })}\n\n(This runs: git config --global --add safe.directory)`
        );
        if (shouldFix) {
          try {
            await invoke("git_add_safe_directory", { path: rootPath });
            // Retry after fixing
            await refreshGit();
            return;
          } catch (fixErr) {
            console.error("[Git safe dir fix error]", fixErr);
          }
        }
      } else if (!isNotGitRepoError) {
        console.error("[Git refresh error]", err);
      }
      setIsGitRepo(false);
      setStagedChanges([]);
      setGitChanges([]);
      setBranches([]);
      setCurrentBranch("");
    }
  }, [rootPath]);

  useEffect(() => {
    if (activeSidebarTab !== "git" || !rootPath) return;

    refreshGit();

    // Poll every 5 seconds while the git tab is active and the window is visible
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshGit();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [activeSidebarTab, rootPath, refreshGit]);

  const handleGitInit = async () => { if (!rootPath) return; setGitLoading(true); try { await invoke("git_init", { path: rootPath }); setIsGitRepo(true); await refreshGit(); flash(t('git.status.init_success')); } catch (e) { flash(t('git.error', { message: String(e) })); } finally { setGitLoading(false); } };
  const handleCommit = async () => { if (!rootPath || !commitMessage.trim()) return; setGitLoading(true); try { await invoke("git_commit", { path: rootPath, message: commitMessage }); setCommitMessage(""); await refreshGit(); flash(t('git.status.commit_success')); } catch (e) { flash(t('git.error', { message: String(e) })); } finally { setGitLoading(false); } };
  const handlePush = async () => { if (!rootPath) return; setGitLoading(true); try { await invoke("git_push", { path: rootPath }); flash(t('git.status.push_success')); } catch (e) { flash(t('git.error', { message: String(e) })); } finally { setGitLoading(false); } };
  const handleStage = async (file: string) => { if (!rootPath) return; try { await invoke("git_add", { path: rootPath, files: [file] }); await refreshGit(); } catch (e) { flash(t('git.error', { message: String(e) })); } };
  const handleUnstage = async (file: string) => { if (!rootPath) return; try { await invoke("git_unstage", { path: rootPath, files: [file] }); await refreshGit(); } catch (e) { flash(t('git.error', { message: String(e) })); } };
  const handleStageAll = async () => { if (!rootPath) return; try { await invoke("git_add", { path: rootPath, files: ["."] }); await refreshGit(); flash(t('git.status.all_staged')); } catch (e) { flash(t('git.error', { message: String(e) })); } };
  const flash = (msg: string) => { setGitFeedback(msg); setTimeout(() => setGitFeedback(""), 3000); };

  const handleAiSuggest = async () => {
    if (!rootPath) return;
    setAiSuggestLoading(true);
    try {
      const diff = await invoke("get_git_diff", { path: rootPath });
      if (!diff.trim()) { flash(t('git.status.no_staged_changes')); setAiSuggestLoading(false); return; }

      const res = await fetch(`${aiSettings.endpoint || "http://localhost:11434"}/api/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3", // Or choose a better default if needed
          prompt: `Based on this git diff, write a concise commit message in conventional commits format. Output ONLY the message.\n\n${diff.substring(0, 3000)}`,
          stream: false
        }),
      });
      const data = await res.json();
      if (data.response) setCommitMessage(data.response.trim());
    } catch (e) { flash(t('git.error', { message: String(e) })); }
    finally { setAiSuggestLoading(false); }
  };

  // File click
  const handleEntryClick = async (entry: FileEntry) => {
    if (entry.is_dir) {
      const exp = expandedDirs[entry.path];
      setExpandedDirs((p) => ({ ...p, [entry.path]: !exp }));
      if (!exp && (!entry.children || entry.children.length === 0)) await loadDirectory(entry.path, entry.path);
    } else {
      const bins = [".png",".jpg",".jpeg",".gif",".exe",".dll",".bin",".zip",".pdf",".ico",".woff",".woff2",".ttf"];
      if (bins.some((e) => entry.name.toLowerCase().endsWith(e))) {
        openFile(entry.path, entry.name, "", "binary");
        return;
      }
      try {
        const c = await invoke("read_file", { path: entry.path }, { silent: true });
        openFile(entry.path, entry.name, c);
      } catch (e) {
        const msg = typeof e === "string" ? e : String(e);
        if (msg.includes("UTF-8")) {
          openFile(entry.path, entry.name, "", "binary");
        } else {
          console.error("[GitExplorer] Failed to read file", entry.path, e);
        }
      }
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || !rootPath) return;
    setIsSearching(true);
    try { setSearchResults(await invoke("search_in_project", { query: searchQuery, rootPath })); }
    catch (e) { console.error(e); } finally { setIsSearching(false); }
  };

  const handleSearchClick = async (r: SearchResult) => {
    try { const c = await invoke("read_file", { path: r.file_path }); openFile(r.file_path, r.file_name, c); } catch {}
  };

  const handleDeleteItem = async (entry: FileEntry) => {
    const isFolder = entry.is_dir;
    const confirmMsg = isFolder
      ? t('git.explorer.delete_folder_confirm', { name: entry.name })
      : t('git.explorer.delete_file_confirm', { name: entry.name });

    if (await ask(confirmMsg, { title: 'Trixty IDE', kind: 'warning' })) {
      try {
        await invoke("delete_path", { path: entry.path });
        if (!isFolder) {
          closeFile(entry.path);
        }
        const parent = entry.path.split('/').slice(0, -1).join('/');
        loadDirectory(parent || rootPath!, parent === rootPath ? undefined : parent);
      } catch (e) {
        console.error("Delete error:", e);
      }
    }
  };

  // Empty state
  const Empty = ({ title, icon }: { title: string; icon: React.ReactNode }) => (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <div className="p-5 bg-[#111] rounded-2xl border border-[#1e1e1e]">
        <div className="text-[#333] mb-3 flex justify-center">{icon}</div>
        <h3 className="text-[13px] font-medium text-[#888] mb-1.5">{title}</h3>
        <p className="text-[11px] text-[#444] mb-5">{t('explorer.open_project')}</p>
        <button onClick={handleOpenFolder} className="w-full py-2 px-4 bg-white text-black text-[11px] font-semibold rounded-lg hover:bg-white/90 transition-all active:scale-95">
          {t('explorer.open_button')}
        </button>
      </div>
    </div>
  );

  // Section header
  const Header = ({ title, right }: { title: string; right?: React.ReactNode }) => (
    <div className="h-[40px] flex items-center justify-between px-4 border-b border-[#1a1a1a] shrink-0">
      <span className="text-[10px] font-semibold text-[#555] uppercase tracking-widest">{title}</span>
      {right}
    </div>
  );

  // ============ EXPLORER ============
  if (activeSidebarTab === "explorer") {
    return (
      <div className="h-full bg-[#0e0e0e] flex flex-col overflow-hidden select-none">
        <Header title={t('explorer.title')} right={
          <div className="flex items-center gap-1">
            <button onClick={() => rootPath && loadDirectory(rootPath)} className="p-1 text-[#444] hover:text-white transition-colors rounded"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
            <button onClick={handleOpenFolder} className="p-1 text-[#444] hover:text-white transition-colors rounded"><FolderOpen size={13} /></button>
          </div>
        } />
        <div
          className="flex-1 overflow-y-auto py-1 scrollbar-thin relative"
          onContextMenu={(ev) => {
            if (ev.currentTarget === ev.target) {
              ev.preventDefault();
              // Right click on empty area - target root
              if (rootPath) {
                setContextMenu({
                  x: ev.clientX,
                  y: ev.clientY,
                  entry: { name: "", path: rootPath, is_dir: true }
                });
              }
            }
          }}
        >
          {!rootPath ? <Empty title={t('explorer.title')} icon={<Folder size={40} strokeWidth={1} />} /> : (
            (function render(items: FileEntry[], level = 0): React.ReactNode {
              const currentItems = [...items];

              return (
                <>
                  {items.map((e) => {
                    const isActive = currentFile?.path === e.path;
                    return (
                      <div key={e.path}>
                        <div
                          onClick={() => handleEntryClick(e)}
                          onContextMenu={(ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            setContextMenu({ x: ev.clientX, y: ev.clientY, entry: e });
                          }}
                          style={{ paddingLeft: `${level * 14 + 12}px` }}
                          className={`
                            flex items-center py-[4px] hover:bg-white/[0.04] cursor-pointer text-[13px] gap-2 transition-colors group
                            ${isActive ? 'bg-white/[0.08] text-white border-l-2 border-white/40' : 'text-[#999]'}
                            ${contextMenu?.entry.path === e.path ? 'bg-white/[0.06] text-white' : ''}
                          `}
                        >
                          {e.is_dir ? (expandedDirs[e.path] ? <ChevronDown size={13} className="text-[#555]" /> : <ChevronRight size={13} className="text-[#555]" />) : <div className="w-[13px]" />}
                          {e.is_dir ? <Folder size={15} className={`${isActive ? 'text-white' : 'text-[#666]'}`} /> : <File size={15} className={`${isActive ? 'text-white' : 'text-[#444]'}`} />}
                          <span className={`truncate text-[12px] ${isActive ? 'font-medium' : ''}`}>{e.name}</span>
                        </div>

                        {/* New Item Input Inline */}
                        {newEntry && newEntry.parentPath === e.path && expandedDirs[e.path] && (
                          <div style={{ paddingLeft: `${(level + 1) * 14 + 12}px` }} className="flex items-center py-1 gap-2">
                            {newEntry.type === "file" ? <File size={13} className="text-[#444]" /> : <Folder size={13} className="text-[#666]" />}
                            <input
                              autoFocus
                              value={newEntryName}
                              onChange={(ev) => setNewEntryName(ev.target.value)}
                              onKeyDown={(ev) => {
                                if (ev.key === "Enter") handleCreateEntry();
                                if (ev.key === "Escape") setNewEntry(null);
                              }}
                              onBlur={handleCreateEntry}
                              className="bg-[#111] border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white focus:outline-none focus:border-white/20 w-full mr-2"
                            />
                          </div>
                        )}

                        {e.is_dir && expandedDirs[e.path] && e.children && render(e.children, level + 1)}
                      </div>
                    );
                  })}

                  {/* Handle new entry in the root */}
                  {newEntry && newEntry.parentPath === rootPath && level === 0 && (
                    <div style={{ paddingLeft: "12px" }} className="flex items-center py-1 gap-2">
                      {newEntry.type === "file" ? <File size={13} className="text-[#444]" /> : <Folder size={13} className="text-[#666]" />}
                      <input
                        autoFocus
                        value={newEntryName}
                        onChange={(ev) => setNewEntryName(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") handleCreateEntry();
                          if (ev.key === "Escape") setNewEntry(null);
                        }}
                        onBlur={handleCreateEntry}
                        className="bg-[#111] border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white focus:outline-none focus:border-white/20 w-32"
                      />
                    </div>
                  )}
                </>
              );
            })(entries)
          )}
        </div>

        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            items={[
              { label: t('git.explorer.new_file'), icon: <FilePlus size={14} />, disabled: !contextMenu.entry.is_dir, onClick: () => {
                const target = contextMenu.entry.is_dir ? contextMenu.entry.path : contextMenu.entry.path.split('/').slice(0, -1).join('/');
                if (contextMenu.entry.is_dir) setExpandedDirs(prev => ({ ...prev, [target]: true }));
                setNewEntry({ parentPath: target, type: "file" });
              }},
              { label: t('git.explorer.new_folder'), icon: <FolderOpen size={14} />, disabled: !contextMenu.entry.is_dir, onClick: () => {
                const target = contextMenu.entry.is_dir ? contextMenu.entry.path : contextMenu.entry.path.split('/').slice(0, -1).join('/');
                if (contextMenu.entry.is_dir) setExpandedDirs(prev => ({ ...prev, [target]: true }));
                setNewEntry({ parentPath: target, type: "folder" });
              }},
              { label: t('git.explorer.reveal'), icon: <Eye size={14} />, shortcut: "Shift+Alt+R", onClick: () => invoke("reveal_path", { path: contextMenu.entry.path }) },
              { label: t('git.explorer.terminal'), icon: <TerminalIcon size={14} />, onClick: () => {
                const dir = contextMenu.entry.is_dir ? contextMenu.entry.path : contextMenu.entry.path.split('/').slice(0, -1).join('/');
                openTerminal(dir);
              }},
              { separator: true },
              { label: t('git.explorer.copy_path'), icon: <Copy size={14} />, shortcut: "Shift+Alt+C", onClick: () => navigator.clipboard.writeText(contextMenu.entry.path) },
              { label: t('git.explorer.copy_rel_path'), icon: <ExternalLink size={14} />, shortcut: "Ctrl+K Ctrl+Shift+C", onClick: () => {
                const rel = contextMenu.entry.path.replace(rootPath || "", "");
                const relativeResult = rel.startsWith('/') ? rel.substring(1) : rel;
                navigator.clipboard.writeText(relativeResult || ".");
              }},
              { separator: true },
              { label: t('git.explorer.delete'), icon: <Trash2 size={14} />, disabled: contextMenu.entry.path === rootPath, onClick: () => handleDeleteItem(contextMenu.entry) },
            ]}
          />
        )}
      </div>
    );
  }

  // ============ SEARCH ============
  if (activeSidebarTab === "search") {
    return (
      <div className="h-full bg-[#0e0e0e] flex flex-col overflow-hidden">
        <Header title={t('search.title')} />
        {!rootPath ? <Empty title={t('search.global')} icon={<Search size={40} strokeWidth={1} />} /> : (
          <div className="flex flex-col h-full">
            <div className="p-3 border-b border-[#1a1a1a]">
              <div className="relative">
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="w-full bg-[#141414] border border-[#222] rounded-lg h-8 pl-8 pr-3 text-[12px] text-white placeholder-[#444] focus:border-[#444] focus:outline-none transition-colors" placeholder={t('search.placeholder')} />
                <Search size={13} className="absolute left-2.5 top-[9px] text-[#444]" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {isSearching ? <div className="flex justify-center p-6"><RefreshCw size={14} className="animate-spin text-[#444]" /></div> :
               searchResults.length > 0 ? searchResults.map((r, i) => (
                <div key={i} onClick={() => handleSearchClick(r)} className="px-3 py-2.5 border-b border-[#1a1a1a] hover:bg-white/[0.03] cursor-pointer">
                  <div className="flex items-center gap-2 mb-1">
                    <File size={11} className="text-[#555]" />
                    <span className="text-[11px] text-white font-medium truncate">{r.file_name}</span>
                    <span className="text-[10px] text-[#444]">:{r.line_number}</span>
                  </div>
                  <p className="text-[11px] text-[#555] font-mono truncate">{r.content}</p>
                </div>
              )) : (
                <div className="flex flex-col items-center justify-center h-32 text-[#333] text-center p-4">
                  <Search size={28} strokeWidth={1} className="mb-2" />
                  <p className="text-[11px]">{t('search.empty')}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============ GIT ============
  if (activeSidebarTab === "git") {
    return (
      <div className="h-full bg-[#0e0e0e] flex flex-col overflow-hidden">
        <Header title={t('git.title')} right={isGitRepo ? (
          <button onClick={refreshGit} className="p-1 text-[#444] hover:text-white transition-colors rounded"><RefreshCw size={13} className={gitLoading ? "animate-spin" : ""} /></button>
        ) : undefined} />

        {!rootPath ? <Empty title={t('git.title')} icon={<GitBranch size={40} strokeWidth={1} />} /> : !isGitRepo ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <div className="p-5 bg-[#111] rounded-2xl border border-[#1e1e1e]">
              <GitBranch size={40} strokeWidth={1} className="text-[#333] mx-auto mb-3" />
              <h3 className="text-[13px] font-medium text-[#888] mb-1.5">{t('git.no_repo')}</h3>
              <p className="text-[11px] text-[#444] mb-5">{t('git.no_repo_desc')}</p>
              <button onClick={handleGitInit} disabled={gitLoading} className="w-full py-2 px-4 bg-white text-black text-[11px] font-semibold rounded-lg hover:bg-white/90 transition-all active:scale-95 disabled:opacity-40">
                {gitLoading ? t('common.loading') : t('git.init_button')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {gitFeedback && <div className="px-3 py-2 bg-white/5 border-b border-[#1a1a1a] text-[11px] text-white/70">{gitFeedback}</div>}

            {/* Branch */}
            <div className="px-3 py-2 border-b border-[#1a1a1a]">
              <button onClick={() => setShowBranchMenu(!showBranchMenu)} className="flex items-center gap-2 w-full text-[12px] text-white hover:bg-white/[0.04] rounded-lg p-1.5 transition-colors">
                <GitBranch size={13} className="text-[#666]" />
                <span className="font-medium truncate">{currentBranch || "main"}</span>
                {showBranchMenu ? <ChevronUp size={11} className="ml-auto text-[#555]" /> : <ChevronDown size={11} className="ml-auto text-[#555]" />}
              </button>
              {showBranchMenu && (
                <div className="mt-1 bg-[#141414] border border-[#222] rounded-xl overflow-hidden">
                  {branches.map((b) => <button key={b} className="w-full text-left px-3 py-1.5 text-[11px] text-[#999] hover:bg-white/[0.04] transition-colors">{b}</button>)}
                  <div className="border-t border-[#222] p-2 flex gap-1">
                    <input value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} placeholder={t('git.new_branch')}
                      className="flex-1 bg-[#0e0e0e] border border-[#222] rounded-md px-2 py-1 text-[11px] text-white placeholder-[#444] focus:outline-none focus:border-[#444]" />
                    <button className="p-1 bg-white text-black rounded-md hover:bg-white/90 transition-colors"><Plus size={13} /></button>
                  </div>
                </div>
              )}
            </div>

            {/* Commit */}
            <div className="px-3 py-3 border-b border-[#1a1a1a]">
              <textarea value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleCommit(); }}
                placeholder={t('git.commit_placeholder')}
                className="w-full bg-[#141414] border border-[#222] rounded-xl p-2.5 text-[12px] text-white placeholder-[#444] focus:outline-none focus:border-[#444] resize-none h-[56px] transition-colors" />
              <div className="flex gap-1.5 mt-2">
                <button onClick={handleCommit} disabled={!commitMessage.trim() || gitLoading}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-white text-black text-[11px] font-semibold rounded-lg transition-all disabled:opacity-30 active:scale-95 hover:bg-white/90">
                  <GitCommit size={13} /> {t('git.commit_button')}
                </button>
                <button onClick={handleAiSuggest} disabled={aiSuggestLoading} title={t('git.suggest_ai')}
                  className="w-8 flex items-center justify-center bg-[#1a1a1a] border border-[#222] text-white/60 rounded-lg transition-all disabled:opacity-30 active:scale-95 hover:bg-[#222] hover:text-white">
                  <Sparkles size={13} className={aiSuggestLoading ? "animate-pulse" : ""} />
                </button>
                <button onClick={handlePush} disabled={gitLoading} title={t('git.action.push')}
                  className="w-8 flex items-center justify-center bg-[#1a1a1a] border border-[#222] text-white/60 rounded-lg transition-all disabled:opacity-30 active:scale-95 hover:bg-[#222] hover:text-white">
                  <Upload size={13} />
                </button>
              </div>
            </div>

            {/* Staged Changes */}
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-[#444] uppercase tracking-widest">{t('git.staged', { count: stagedChanges.length.toString() })}</span>
              </div>
              {stagedChanges.length === 0 ? (
                <div className="text-center pb-3 text-[11px] text-[#333]">{t('git.no_staged')}</div>
              ) : stagedChanges.map((c, i) => {
                const m = STATUS_META[c.status] || STATUS_META["M"];
                const I = m.icon;
                return (
                  <div key={i} className="group flex items-center gap-2 px-4 py-1.5 hover:bg-white/[0.03] text-[12px]">
                    <I size={13} className={m.color} />
                    <span className="truncate flex-1 text-[#999]">{c.file}</span>
                    <button onClick={() => handleUnstage(c.file)} title={t('git.action.unstage')}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-[#555] hover:text-white transition-all rounded">
                      <Minus size={13} strokeWidth={1.5} />
                    </button>
                  </div>
                );
              })}

              {/* Unstaged Changes */}
              <div className="border-t border-[#1a1a1a] mt-1">
                <div className="px-3 py-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-[#444] uppercase tracking-widest">{t('git.changes', { count: gitChanges.length.toString() })}</span>
                  {gitChanges.length > 0 && (
                    <button onClick={handleStageAll} title={t('git.action.stage_all')} className="text-[10px] text-[#555] hover:text-white transition-colors px-1.5 py-0.5 rounded hover:bg-white/[0.06]">
                      + {t('git.all')}
                    </button>
                  )}
                </div>
                {gitChanges.length === 0 ? (
                  <div className="text-center pb-4 text-[11px] text-[#333]">{t('git.no_pending')}</div>
                ) : gitChanges.map((c, i) => {
                  const m = STATUS_META[c.status] || STATUS_META["M"];
                  const I = m.icon;
                  return (
                    <div key={i} className="group flex items-center gap-2 px-4 py-1.5 hover:bg-white/[0.03] text-[12px]">
                      <I size={13} className={m.color} />
                      <span className="truncate flex-1 text-[#999]">{c.file}</span>
                      <button onClick={() => handleStage(c.file)} title={t('git.action.stage')}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-[#555] hover:text-white transition-all rounded">
                        <Plus size={13} strokeWidth={1.5} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============ EXTENSIONS ============
  if (activeSidebarTab === "extensions") {
    return (
      <div className="h-full bg-[#0e0e0e] flex flex-col overflow-hidden">
        <Header title={t('extensions.title')} />
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
          <div className="p-5 bg-[#111] rounded-2xl border border-[#1e1e1e]">
            <Package size={40} strokeWidth={1} className="text-[#333] mx-auto mb-3" />
            <h3 className="text-[13px] font-medium text-[#888] mb-1.5">{t('marketplace.title')}</h3>
            <p className="text-[11px] text-[#444] mb-5">{t('marketplace.desc')}</p>
            <button onClick={() => openFile("virtual://extensions", "Extensions", "", "virtual")}
              className="w-full py-2 px-4 bg-white text-black text-[11px] font-semibold rounded-lg hover:bg-white/90 transition-all active:scale-95">
              {t('marketplace.button')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default GitExplorerComponent;
