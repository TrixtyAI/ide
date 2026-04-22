"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Folder, File, ChevronRight, ChevronDown, RefreshCw, FolderOpen, Search,
  GitBranch, GitCommit, Upload, Plus, Sparkles, ChevronUp,
  FilePlus, FileX, FileEdit, Package, Terminal as TerminalIcon, Eye, Copy, ExternalLink, History, Trash2,
  Minus, ArrowDown, Download, GitMerge, Archive, RotateCcw, Undo2, Check, AlertTriangle
} from "lucide-react";
import { safeInvoke as invoke } from "@/api/tauri";
import type { GitLogEntry, GitStashEntry } from "@/api/tauri";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";
import ContextMenu from "@/components/ui/ContextMenu";
import { useClickOutside } from "@/hooks/useClickOutside";
import { logger } from "@/lib/logger";
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

function relativeParts(unixSeconds: number): { unit: "s" | "m" | "h" | "d" | "mo" | "y"; n: number } {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (diff < 60) return { unit: "s", n: diff };
  if (diff < 3600) return { unit: "m", n: Math.floor(diff / 60) };
  if (diff < 86400) return { unit: "h", n: Math.floor(diff / 3600) };
  if (diff < 2592000) return { unit: "d", n: Math.floor(diff / 86400) };
  if (diff < 31536000) return { unit: "mo", n: Math.floor(diff / 2592000) };
  return { unit: "y", n: Math.floor(diff / 31536000) };
}

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
  const [gitLog, setGitLog] = useState<GitLogEntry[]>([]);
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showStash, setShowStash] = useState(false);
  const [stashMessage, setStashMessage] = useState("");
  const [hasConflicts, setHasConflicts] = useState(false);
  const [amendMode, setAmendMode] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [logLimit, setLogLimit] = useState(30);
  const [diffModal, setDiffModal] = useState<{ file: string; staged: boolean; content: string } | null>(null);
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const gitLoadingRef = useRef(false);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitMenuRef = useRef<HTMLDivElement | null>(null);

  useClickOutside(commitMenuRef, () => setCommitMenuOpen(false), commitMenuOpen);

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
    } catch (e) { logger.error(e); } finally { setLoading(false); }
  }, [rootPath, systemSettings.filesExclude]);

  const handleOpenFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: t('explorer.select_folder') });
      if (selected && typeof selected === "string") { setRootPath(selected); setEntries([]); setExpandedDirs({}); loadDirectory(selected); }
    } catch (e) { logger.error(e); }
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
    // Intentionally exclude `expandedDirs`: this effect updates it via `setExpandedDirs`,
    // so including it would retrigger auto-reveal after every expansion change and cause
    // repeated directory loading/re-expansion loops for the same selected file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      logger.error(e);
    } finally {
      setNewEntry(null);
      setNewEntryName("");
    }
  };

  // Git
  const refreshGit = useCallback(async () => {
    if (!rootPath) return;

    // All four sub-queries read from the same working tree and don't depend
    // on each other's results, so fire them in parallel. Each one spawns its
    // own `git` process on the backend and the serial chain used to dominate
    // the 5 s poll cycle — measured ~150-400 ms wall time per refresh;
    // concurrent dispatch brings that down to ~max(single call) instead of
    // sum(all calls). `allSettled` is used so a failure in one (say
    // `git_log` on a brand-new repo with no commits) doesn't drop the
    // status/branches output the rest of the UI depends on.
    const [statusResult, branchesResult, logResult, stashResult] = await Promise.allSettled([
      invoke("get_git_status", { path: rootPath }, { silent: true }),
      invoke("get_git_branches", { path: rootPath }),
      invoke("git_log", { path: rootPath, limit: logLimit }, { silent: true }),
      invoke("git_stash_list", { path: rootPath }, { silent: true }),
    ]);

    if (statusResult.status === "rejected") {
      const errStr = String(statusResult.reason).toLowerCase();
      const isNotGitRepoError =
        errStr.includes("not a git repository") ||
        errStr.includes("must be run in a work tree");
      if (errStr.includes("dubious ownership")) {
        // Use Tauri's native dialog instead of `window.confirm`: the Tauri
        // webview can block synchronous dialogs depending on CSP, and
        // `window.confirm` freezes the whole event loop — including
        // Tauri's IPC channel — which starves any invoke in flight. The
        // `ask` plugin was already imported for other prompts in this
        // file, so this swap is a one-liner.
        const shouldFix = await ask(
          `${t('git.explorer.safe_dir_desc', { path: rootPath })}\n\n(This runs: git config --global --add safe.directory)`,
          { title: t('git.explorer.safe_dir_title'), kind: 'warning' },
        );
        if (shouldFix) {
          try {
            await invoke("git_add_safe_directory", { path: rootPath });
            // Retry after fixing
            await refreshGit();
            return;
          } catch (fixErr) {
            logger.error("[Git safe dir fix error]", fixErr);
          }
        }
      } else if (!isNotGitRepoError) {
        logger.error("[Git refresh error]", statusResult.reason);
      }
      setIsGitRepo(false);
      setStagedChanges([]);
      setGitChanges([]);
      setBranches([]);
      setCurrentBranch("");
      setGitLog([]);
      setStashes([]);
      setHasConflicts(false);
      return;
    }

    // Status succeeded — parse it and assume the rest should populate too.
    setIsGitRepo(true);
    const lines = statusResult.value.split("\n").filter((l: string) => l.trim());
    // Porcelain v1: XY filename
    // X = staged status, Y = unstaged status
    const staged: GitFileChange[] = [];
    const unstaged: GitFileChange[] = [];
    let conflicts = false;
    for (const l of lines) {
      const x = l[0]; // staged
      const y = l[1]; // unstaged
      const file = l.substring(3).trim();
      // Unmerged/conflict codes per porcelain v1: DD AU UD UA DU AA UU.
      if ((x === "U" || y === "U") || (x === "A" && y === "A") || (x === "D" && y === "D")) {
        conflicts = true;
      }
      if (x !== " " && x !== "?") staged.push({ status: x, file });
      if (y !== " " && y !== "?") unstaged.push({ status: y, file });
      // Untracked files (??) go to unstaged
      if (x === "?" && y === "?") unstaged.push({ status: "??", file });
    }
    setHasConflicts(conflicts);
    setStagedChanges(staged);
    setGitChanges(unstaged);

    if (branchesResult.status === "fulfilled") {
      const payload = branchesResult.value;
      const branchList = Array.isArray(payload?.branches) ? payload.branches : [];
      setBranches(branchList);
      setCurrentBranch(payload?.current ?? "");
    } else {
      setBranches([]);
      setCurrentBranch("");
    }

    setGitLog(
      logResult.status === "fulfilled" && Array.isArray(logResult.value)
        ? logResult.value
        : []
    );
    setStashes(
      stashResult.status === "fulfilled" && Array.isArray(stashResult.value)
        ? stashResult.value
        : []
    );
    // Intentionally exclude `t`: re-creating `refreshGit` on every locale change would
    // invalidate the `useEffect` that polls it and retrigger the whole git refresh on
    // language switch. Error messages read via `t` only need to be current at the time
    // the error surfaces, not at callback-creation time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, logLimit]);

  useEffect(() => { gitLoadingRef.current = gitLoading; }, [gitLoading]);

  useEffect(() => () => {
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (activeSidebarTab !== "git" || !rootPath) return;

    refreshGit();

    // Poll every 5 seconds while the git tab is active, the window is visible,
    // and the app actually has focus. `hasFocus()` is stricter than
    // `visibilityState`: a visible-but-unfocused window (user typing in the
    // browser) still costs a `git status`+`git log`+… every 5 s today, and on
    // battery that dominates idle CPU. Gating the interval also drops the
    // child-process wake-ups that were firing for no visible change.
    const interval = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        !gitLoadingRef.current
      ) {
        refreshGit();
      }
    }, 5000);

    // Snap back to a fresh refresh the moment the user returns, instead of
    // showing up-to-5-s-stale data until the next tick.
    const onFocus = () => {
      if (document.visibilityState === "visible" && !gitLoadingRef.current) {
        refreshGit();
      }
    };
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [activeSidebarTab, rootPath, refreshGit]);

  const handleGitInit = async () => { if (!rootPath) return; setGitLoading(true); try { await invoke("git_init", { path: rootPath }); setIsGitRepo(true); await refreshGit(); flash(t('git.status.init_success')); } catch (e) { flash(t('git.error', { message: String(e) })); } finally { setGitLoading(false); } };
  const handleCheckoutBranch = async (branch: string) => {
    if (!rootPath || branch === currentBranch) { setShowBranchMenu(false); return; }
    setGitLoading(true);
    try {
      await invoke("git_checkout_branch", { path: rootPath, branch });
      setShowBranchMenu(false);
      await refreshGit();
      flash(t('git.status.checkout_success', { branch }));
    } catch (e) {
      flash(t('git.error', { message: String(e) }));
    } finally {
      setGitLoading(false);
    }
  };
  const handleCreateBranch = async () => {
    const name = newBranchName.trim();
    if (!rootPath || !name) return;
    setGitLoading(true);
    try {
      await invoke("git_create_branch", { path: rootPath, branch: name });
      setNewBranchName("");
      setShowBranchMenu(false);
      await refreshGit();
      flash(t('git.status.branch_created'));
    } catch (e) {
      flash(t('git.error', { message: String(e) }));
    } finally {
      setGitLoading(false);
    }
  };
  const handleCommit = async () => { if (!rootPath || !commitMessage.trim()) return; setGitLoading(true); try { await invoke("git_commit", { path: rootPath, message: commitMessage, amend: amendMode }); setCommitMessage(""); setAmendMode(false); await refreshGit(); flash(t('git.status.commit_success')); } catch (e) { flash(t('git.error', { message: String(e) })); } finally { setGitLoading(false); } };
  const handlePush = async () => { if (!rootPath) return; setGitLoading(true); try { await invoke("git_push", { path: rootPath }); flash(t('git.status.push_success')); } catch (e) { flash(t('git.error', { message: String(e) })); } finally { setGitLoading(false); } };
  const handlePull = async (rebase = false) => { if (!rootPath) return; setGitLoading(true); try { await invoke("git_pull", { path: rootPath, rebase }); await refreshGit(); flash(t('git.status.pull_success')); } catch (e) { flash(t('git.error', { message: String(e) })); } finally { setGitLoading(false); } };
  const handleDiscard = async (file: string) => {
    if (!rootPath) return;
    if (!(await ask(t('git.discard.confirm', { file }), { title: 'Trixty IDE', kind: 'warning' }))) return;
    setGitLoading(true);
    try {
      await invoke("git_restore", { path: rootPath, files: [file] });
      await refreshGit();
    } catch (e) { flash(t('git.error', { message: String(e) })); }
    finally { setGitLoading(false); }
  };
  const handleViewDiff = async (file: string, staged: boolean) => {
    if (!rootPath) return;
    try {
      const content = await invoke("get_git_file_diff", { path: rootPath, file, staged });
      setDiffModal({ file, staged, content });
    } catch (e) { flash(t('git.error', { message: String(e) })); }
  };
  const handleFetch = async () => { if (!rootPath) return; setGitLoading(true); try { await invoke("git_fetch", { path: rootPath }); await refreshGit(); flash(t('git.status.fetch_success')); } catch (e) { flash(t('git.error', { message: String(e) })); } finally { setGitLoading(false); } };
  const handleMerge = async (branch: string) => {
    if (!rootPath) return;
    if (!(await ask(t('git.merge.confirm', { branch }), { title: 'Trixty IDE', kind: 'warning' }))) return;
    setGitLoading(true);
    try {
      await invoke("git_merge", { path: rootPath, branch });
      setShowBranchMenu(false);
      await refreshGit();
      flash(t('git.status.merge_success'));
    } catch (e) { flash(t('git.error', { message: String(e) })); }
    finally { setGitLoading(false); }
  };
  const handleStash = async () => {
    if (!rootPath) return;
    setGitLoading(true);
    try {
      await invoke("git_stash", { path: rootPath, message: stashMessage.trim() || undefined });
      setStashMessage("");
      await refreshGit();
      flash(t('git.status.stash_success'));
    } catch (e) { flash(t('git.error', { message: String(e) })); }
    finally { setGitLoading(false); }
  };
  const handleStashPop = async (index: number) => {
    if (!rootPath) return;
    setGitLoading(true);
    try {
      await invoke("git_stash_pop", { path: rootPath, index });
      await refreshGit();
      flash(t('git.status.stash_pop_success'));
    } catch (e) { flash(t('git.error', { message: String(e) })); }
    finally { setGitLoading(false); }
  };
  const handleStashApply = async (index: number) => {
    if (!rootPath) return;
    setGitLoading(true);
    try {
      await invoke("git_stash_apply", { path: rootPath, index });
      await refreshGit();
      flash(t('git.status.stash_pop_success'));
    } catch (e) { flash(t('git.error', { message: String(e) })); }
    finally { setGitLoading(false); }
  };
  const handleStashDrop = async (entry: GitStashEntry) => {
    if (!rootPath) return;
    if (!(await ask(t('git.stash.drop_confirm', { ref: entry.ref_name }), { title: 'Trixty IDE', kind: 'warning' }))) return;
    setGitLoading(true);
    try {
      await invoke("git_stash_drop", { path: rootPath, index: entry.index });
      await refreshGit();
    } catch (e) { flash(t('git.error', { message: String(e) })); }
    finally { setGitLoading(false); }
  };
  const handleReset = async (mode: "soft" | "mixed" | "hard", target: string) => {
    if (!rootPath) return;
    if (mode === "hard" && !(await ask(t('git.reset.confirm_hard', { target }), { title: 'Trixty IDE', kind: 'warning' }))) return;
    if (mode === "mixed" && !(await ask(t('git.reset.confirm_mixed', { target }), { title: 'Trixty IDE', kind: 'warning' }))) return;
    setGitLoading(true);
    try {
      await invoke("git_reset", { path: rootPath, mode, target });
      await refreshGit();
      flash(t('git.status.reset_success'));
    } catch (e) { flash(t('git.error', { message: String(e) })); }
    finally { setGitLoading(false); }
  };
  const handleRevert = async (commit: string, shortHash: string) => {
    if (!rootPath) return;
    if (!(await ask(t('git.revert.confirm', { hash: shortHash }), { title: 'Trixty IDE', kind: 'warning' }))) return;
    setGitLoading(true);
    try {
      await invoke("git_revert", { path: rootPath, commit });
      await refreshGit();
      flash(t('git.status.revert_success'));
    } catch (e) { flash(t('git.error', { message: String(e) })); }
    finally { setGitLoading(false); }
  };
  const handleStage = async (file: string) => { if (!rootPath) return; try { await invoke("git_add", { path: rootPath, files: [file] }); await refreshGit(); } catch (e) { flash(t('git.error', { message: String(e) })); } };
  const handleUnstage = async (file: string) => { if (!rootPath) return; try { await invoke("git_unstage", { path: rootPath, files: [file] }); await refreshGit(); } catch (e) { flash(t('git.error', { message: String(e) })); } };
  const handleStageAll = async () => { if (!rootPath) return; try { await invoke("git_add", { path: rootPath, files: ["."] }); await refreshGit(); flash(t('git.status.all_staged')); } catch (e) { flash(t('git.error', { message: String(e) })); } };
  const flash = (msg: string) => {
    setGitFeedback(msg);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setGitFeedback(""), 3000);
  };

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
          logger.error("[GitExplorer] Failed to read file", entry.path, e);
        }
      }
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || !rootPath) return;
    setIsSearching(true);
    try {
      setSearchResults(
        await invoke("search_in_project", {
          query: searchQuery,
          rootPath,
          filesExclude: systemSettings.filesExclude,
        }),
      );
    } catch (e) { logger.error(e); } finally { setIsSearching(false); }
  };

  const handleSearchClick = async (r: SearchResult) => {
    try { const c = await invoke("read_file", { path: r.file_path }, { silent: true }); openFile(r.file_path, r.file_name, c); }
    catch (e) { logger.error("[GitExplorer] Failed to read file", r.file_path, e); }
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
        logger.error("Delete error:", e);
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
                              aria-label={newEntry.type === "file" ? t('git.explorer.new_file') : t('git.explorer.new_folder')}
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
                        aria-label={newEntry.type === "file" ? t('git.explorer.new_file') : t('git.explorer.new_folder')}
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
                  aria-label={t('search.title')}
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
      <div className="h-full bg-[#0e0e0e] flex flex-col overflow-hidden relative">
        <Header title={t('git.title')} right={isGitRepo ? (
          <div className="flex items-center gap-0.5">
            <button onClick={() => handlePull(false)} disabled={gitLoading} title={t('git.action.pull')} className="p-1 text-[#444] hover:text-white disabled:opacity-40 transition-colors rounded"><ArrowDown size={13} /></button>
            <button onClick={() => handlePull(true)} disabled={gitLoading} title={t('git.action.pull_rebase')} className="p-1 text-[#444] hover:text-white disabled:opacity-40 transition-colors rounded"><RotateCcw size={13} /></button>
            <button onClick={handleFetch} disabled={gitLoading} title={t('git.action.fetch')} className="p-1 text-[#444] hover:text-white disabled:opacity-40 transition-colors rounded"><Download size={13} /></button>
            <button onClick={refreshGit} title={t('git.action.refresh')} className="p-1 text-[#444] hover:text-white transition-colors rounded"><RefreshCw size={13} className={gitLoading ? "animate-spin" : ""} /></button>
          </div>
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
            {/* Live regions must stay mounted so screen readers can observe
                text changes; conditional mounting would hide the update. */}
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={
                gitFeedback
                  ? "px-3 py-2 bg-white/[0.03] border-b border-[#1a1a1a] border-l-2 border-l-white/40 text-[11px] text-white/80 flex items-center gap-2"
                  : "sr-only"
              }
            >
              <span className="truncate">{gitFeedback}</span>
            </div>
            {hasConflicts && (
              <div
                role="alert"
                aria-live="assertive"
                className="px-3 py-2 bg-red-500/10 border-b border-red-500/20 border-l-2 border-l-red-400 text-[11px] text-red-200 flex items-center gap-2"
              >
                <AlertTriangle size={12} className="shrink-0 text-red-400" />
                <span>{t('git.conflicts.banner')}</span>
              </div>
            )}

            {/* Branch */}
            <div className="px-3 py-2 border-b border-[#1a1a1a]">
              <button onClick={() => setShowBranchMenu(!showBranchMenu)} className="flex items-center gap-2 w-full text-[12px] text-white hover:bg-white/[0.04] rounded-lg p-1.5 transition-colors">
                <GitBranch size={13} className={!currentBranch ? "text-yellow-400" : "text-[#666]"} />
                {!currentBranch ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-yellow-400/10 border border-yellow-400/20 text-yellow-300 text-[10px] font-medium">
                    <AlertTriangle size={10} /> {t('git.branch.detached')}
                  </span>
                ) : (
                  <span className="font-medium truncate">{currentBranch}</span>
                )}
                {showBranchMenu ? <ChevronUp size={11} className="ml-auto text-[#555]" /> : <ChevronDown size={11} className="ml-auto text-[#555]" />}
              </button>
              {showBranchMenu && (
                <div className="mt-1 bg-[#141414] border border-[#222] rounded-xl overflow-hidden">
                  {branches.length > 6 && (
                    <div className="px-2 pt-2">
                      <input value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}
                        aria-label={t('git.filter.branches')}
                        placeholder={t('git.filter.branches')}
                        className="w-full bg-[#0e0e0e] border border-[#222] rounded-md px-2 py-1 text-[11px] text-white placeholder-[#444] focus:outline-none focus:border-[#444]" />
                    </div>
                  )}
                  <div className="max-h-[200px] overflow-y-auto scrollbar-thin">
                    {branches.filter((b) => !branchFilter || b.toLowerCase().includes(branchFilter.toLowerCase())).map((b) => {
                      const isCurrent = b === currentBranch;
                      return (
                        <div key={b} className="group flex items-center hover:bg-white/[0.04] transition-colors">
                          <button onClick={() => handleCheckoutBranch(b)} disabled={gitLoading}
                            aria-current={isCurrent ? "true" : undefined}
                            className={`flex-1 text-left px-3 py-1.5 text-[11px] flex items-center gap-1.5 transition-colors disabled:opacity-50 ${isCurrent ? "text-white font-medium" : "text-[#999]"}`}>
                            {isCurrent ? <Check size={11} className="text-green-400/80" /> : <span className="w-[11px]" />}
                            <span className="truncate">{b}</span>
                          </button>
                          {!isCurrent && (
                            <button onClick={() => handleMerge(b)} title={t('git.action.merge')}
                              className="opacity-0 group-hover:opacity-100 p-1 mr-1 text-[#555] hover:text-white transition-all rounded">
                              <GitMerge size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="border-t border-[#222] p-2 flex gap-1">
                    <input value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleCreateBranch(); }}
                      aria-label={t('git.new_branch_aria_label')}
                      placeholder={t('git.new_branch')}
                      className="flex-1 bg-[#0e0e0e] border border-[#222] rounded-md px-2 py-1 text-[11px] text-white placeholder-[#444] focus:outline-none focus:border-[#444]" />
                    <button onClick={handleCreateBranch} disabled={!newBranchName.trim() || gitLoading}
                      aria-label={t('git.action.create_branch')} title={t('git.action.create_branch')}
                      className="p-1 bg-white text-black rounded-md hover:bg-white/90 transition-colors disabled:opacity-40"><Plus size={13} /></button>
                  </div>
                </div>
              )}
            </div>

            {/* Commit */}
            <div className="px-3 py-3 border-b border-[#1a1a1a]">
              <textarea value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleCommit(); }}
                aria-label={t('git.commit_message_aria_label')}
                placeholder={amendMode ? `${t('git.commit_placeholder')} (${t('git.action.amend')})` : t('git.commit_placeholder')}
                className="w-full bg-[#141414] border border-[#222] rounded-xl p-2.5 text-[12px] text-white placeholder-[#444] focus:outline-none focus:border-[#444] resize-y min-h-[80px] max-h-[240px] transition-colors" />
              <div className="flex gap-1.5 mt-2">
                <div className="flex flex-1 min-w-0 gap-px">
                  <button onClick={handleCommit} disabled={!commitMessage.trim() || gitLoading || hasConflicts}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-white text-black text-[11px] font-semibold rounded-l-lg transition-all disabled:opacity-30 active:scale-95 hover:bg-white/90">
                    <GitCommit size={13} /> {amendMode ? t('git.action.amend') : t('git.commit_button')}
                  </button>
                  <div className="relative" ref={commitMenuRef}>
                    <button onClick={() => setCommitMenuOpen(!commitMenuOpen)}
                      disabled={!commitMessage.trim() || gitLoading || hasConflicts}
                      aria-label={t('git.action.commit_options')}
                      aria-haspopup="menu"
                      aria-expanded={commitMenuOpen}
                      className={`h-full px-1.5 flex items-center justify-center bg-white text-black rounded-r-lg transition-all disabled:opacity-30 active:scale-95 hover:bg-white/90`}>
                      <ChevronDown size={12} />
                    </button>
                    {commitMenuOpen && (
                      <div className="absolute right-0 top-[calc(100%+4px)] z-20 min-w-[180px] bg-[#141414] border border-[#222] rounded-lg shadow-lg py-1 text-[11px]">
                        <button onClick={() => { setAmendMode(!amendMode); setCommitMenuOpen(false); }}
                          className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-white/[0.05] text-white/80">
                          <span className={`inline-flex items-center justify-center w-3 h-3 rounded-sm border ${amendMode ? "bg-white border-white" : "border-[#333]"}`}>
                            {amendMode && <Check size={10} className="text-black" strokeWidth={3} />}
                          </span>
                          {t('git.action.amend')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
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
                    <button onClick={() => handleViewDiff(c.file, true)} title={t('git.action.view_diff')}
                      className="truncate flex-1 text-left text-[#999] hover:text-white transition-colors">{c.file}</button>
                    <button onClick={() => handleUnstage(c.file)} title={t('git.action.unstage')}
                      className="p-0.5 text-[#555] hover:text-white transition-all rounded">
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
                  const isUntracked = c.status === "??";
                  return (
                    <div key={i} className="group flex items-center gap-2 px-4 py-1.5 hover:bg-white/[0.03] text-[12px]">
                      <I size={13} className={m.color} />
                      <button onClick={() => !isUntracked && handleViewDiff(c.file, false)} title={isUntracked ? undefined : t('git.action.view_diff')}
                        className={`truncate flex-1 text-left text-[#999] ${isUntracked ? "cursor-default" : "hover:text-white"} transition-colors`}>{c.file}</button>
                      {!isUntracked && (
                        <button onClick={() => handleDiscard(c.file)} title={t('git.action.discard')}
                          className="p-0.5 text-[#555] hover:text-red-400 hover:bg-red-400/10 transition-all rounded">
                          <Undo2 size={12} strokeWidth={1.5} />
                        </button>
                      )}
                      <button onClick={() => handleStage(c.file)} title={t('git.action.stage')}
                        className="p-0.5 text-[#555] hover:text-white transition-all rounded">
                        <Plus size={13} strokeWidth={1.5} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Stash */}
              <div className="border-t border-[#1a1a1a] mt-1">
                <button onClick={() => setShowStash(!showStash)} className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                  <span className="text-[10px] font-semibold text-[#555] uppercase tracking-widest flex items-center gap-1.5">
                    <Archive size={11} /> {t('git.section.stash')}
                    {stashes.length > 0 && <span className="px-1.5 py-[1px] rounded-full bg-white/[0.06] text-white/70 text-[9px] font-semibold tracking-normal normal-case">{stashes.length}</span>}
                  </span>
                  {showStash ? <ChevronUp size={11} className="text-[#555]" /> : <ChevronDown size={11} className="text-[#555]" />}
                </button>
                {showStash && (
                  <div>
                    <div className="px-3 pb-2 flex gap-1">
                      <input value={stashMessage} onChange={(e) => setStashMessage(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleStash(); }}
                        aria-label={t('git.stash_message_aria_label')}
                        placeholder={t('git.stash.placeholder')}
                        className="flex-1 bg-[#141414] border border-[#222] rounded-md px-2 py-1 text-[11px] text-white placeholder-[#444] focus:outline-none focus:border-[#444]" />
                      <button onClick={handleStash} disabled={gitLoading} title={t('git.action.stash')}
                        className="px-2 py-1 bg-[#1a1a1a] border border-[#222] text-white/70 text-[11px] rounded-md hover:bg-[#222] hover:text-white transition-colors disabled:opacity-40">
                        <Archive size={12} />
                      </button>
                    </div>
                    {stashes.length === 0 ? (
                      <div className="text-center pb-3 text-[11px] text-[#333]">{t('git.stash.empty')}</div>
                    ) : stashes.map((s) => (
                      <div key={s.index} className="group flex items-center gap-1 px-4 py-1.5 hover:bg-white/[0.03] text-[12px]">
                        <Archive size={12} className="text-[#555] shrink-0" />
                        <span className="truncate flex-1 text-[#999]" title={s.message}>{s.message || s.ref_name}</span>
                        <button onClick={() => handleStashPop(s.index)} title={t('git.action.stash_pop')}
                          className="px-1.5 py-0.5 text-[10px] text-[#888] hover:text-white transition-all rounded">{t('git.action.stash_pop')}</button>
                        <button onClick={() => handleStashApply(s.index)} title={t('git.action.stash_apply')}
                          className="px-1.5 py-0.5 text-[10px] text-[#888] hover:text-white transition-all rounded">{t('git.action.stash_apply')}</button>
                        <button onClick={() => handleStashDrop(s)} title={t('git.action.stash_drop')}
                          className="opacity-40 group-hover:opacity-100 p-0.5 text-[#888] hover:text-red-400 transition-all rounded">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* History */}
              <div className="border-t border-[#1a1a1a]">
                <button onClick={() => setShowHistory(!showHistory)} className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                  <span className="text-[10px] font-semibold text-[#555] uppercase tracking-widest flex items-center gap-1.5">
                    <History size={11} /> {t('git.section.history')}
                    {gitLog.length > 0 && <span className="px-1.5 py-[1px] rounded-full bg-white/[0.06] text-white/70 text-[9px] font-semibold tracking-normal normal-case">{gitLog.length}</span>}
                  </span>
                  {showHistory ? <ChevronUp size={11} className="text-[#555]" /> : <ChevronDown size={11} className="text-[#555]" />}
                </button>
                {showHistory && (gitLog.length === 0 ? (
                  <div className="text-center pb-3 text-[11px] text-[#333]">{t('git.history.empty')}</div>
                ) : (
                  <>
                    {gitLog.map((c) => {
                      const rt = relativeParts(c.timestamp);
                      return (
                        <div key={c.hash} className="group px-4 py-2 hover:bg-white/[0.03] text-[12px] border-b border-[#141414] last:border-b-0">
                          <div className="flex items-center gap-2">
                            <GitCommit size={11} className="text-[#555] shrink-0" />
                            <span className="font-mono text-[10px] text-blue-300/60 shrink-0" title={c.hash}>{c.short_hash}</span>
                            <span className="truncate flex-1 text-[#ccc]" title={c.subject}>{c.subject}</span>
                            <span className="text-[10px] text-[#555] shrink-0 tabular-nums" title={new Date(c.timestamp * 1000).toLocaleString()}>{t(`git.time.${rt.unit}` as const, { n: String(rt.n) })}</span>
                          </div>
                          <div className="flex items-center justify-between mt-1 pl-[19px]">
                            <span className="text-[10px] text-[#555] truncate">{c.author}</span>
                            <div className="flex items-center gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleReset("soft", c.hash)} title={t('git.action.reset_soft')}
                                className="p-0.5 text-[#888] hover:text-white rounded"><RotateCcw size={11} /></button>
                              <button onClick={() => handleReset("mixed", c.hash)} title={t('git.action.reset_mixed')}
                                className="p-0.5 text-yellow-400/60 hover:text-yellow-300 hover:bg-yellow-400/10 rounded"><RotateCcw size={11} strokeWidth={2.5} /></button>
                              <button onClick={() => handleReset("hard", c.hash)} title={t('git.action.reset_hard')}
                                className="p-0.5 text-red-400/60 hover:text-red-400 hover:bg-red-400/10 rounded"><AlertTriangle size={11} /></button>
                              <button onClick={() => handleRevert(c.hash, c.short_hash)} title={t('git.action.revert')}
                                className="p-0.5 text-[#888] hover:text-white rounded"><Undo2 size={11} /></button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {gitLog.length >= logLimit && (
                      <button onClick={() => setLogLimit(logLimit + 30)} disabled={gitLoading}
                        className="w-full py-2 text-[11px] text-[#666] hover:text-white hover:bg-white/[0.03] transition-colors disabled:opacity-40">
                        {t('git.action.load_more')}
                      </button>
                    )}
                  </>
                ))}
              </div>
            </div>
          </div>
        )}

        {diffModal && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 p-3" onClick={() => setDiffModal(null)}>
            <div className="bg-[#0e0e0e] border border-[#222] rounded-xl w-full h-full flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a1a] shrink-0">
                <span className="text-[11px] text-white/80 truncate">{t('git.diff.title', { file: diffModal.file })}</span>
                <button onClick={() => setDiffModal(null)} className="p-1 text-[#555] hover:text-white transition-colors rounded">
                  <Minus size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-auto scrollbar-thin">
                {diffModal.content.trim() === "" ? (
                  <div className="p-6 text-center text-[11px] text-[#555]">{t('git.diff.empty')}</div>
                ) : (
                  <pre className="p-3 text-[11px] font-mono text-[#ccc] whitespace-pre">
                    {diffModal.content.split("\n").map((line, i) => {
                      let cls = "text-[#999]";
                      if (line.startsWith("+") && !line.startsWith("+++")) cls = "text-green-400/90";
                      else if (line.startsWith("-") && !line.startsWith("---")) cls = "text-red-400/90";
                      else if (line.startsWith("@@")) cls = "text-blue-400/80";
                      else if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---")) cls = "text-[#666]";
                      return <div key={i} className={cls}>{line || " "}</div>;
                    })}
                  </pre>
                )}
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
