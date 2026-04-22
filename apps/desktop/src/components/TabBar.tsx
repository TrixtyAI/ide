"use client";

import React, { useState } from "react";
import { X, FileCode, FileText, FileJson, FileType, Package, CircleOff, ArrowRight, FileCheck, Trash2 } from "lucide-react";
import { useApp, FileState } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";
import ContextMenu, { ContextMenuItem } from "./ui/ContextMenu";

// Derive a stable, HTML-id-safe handle from the file path. Shared with
// `EditorArea` so the editor panel can set `aria-labelledby` to the active
// tab's id.
export const EDITOR_TABPANEL_ID = "editor-tabpanel";
export const tabIdFor = (path: string): string =>
  `tab-${path.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

const TabBar: React.FC = () => {
  const { openFiles, currentFile, setCurrentFile, closeFile, closeOthers, closeToTheRight, closeSaved, closeAll } = useApp();
  const { t } = useL10n();
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, targetPath: string } | null>(null);

  const getFileIcon = (file: FileState) => {
    if (file.type === "virtual") {
      return <Package size={13} className="text-white/50" />;
    }
    const ext = file.name.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "js": case "jsx": return <FileCode size={13} className="text-yellow-400/80" />;
      case "ts": case "tsx": return <FileCode size={13} className="text-blue-400/80" />;
      case "json": return <FileJson size={13} className="text-yellow-500/80" />;
      case "md": return <FileText size={13} className="text-white/50" />;
      case "rs": return <FileCode size={13} className="text-orange-400/80" />;
      case "css": case "scss": return <FileCode size={13} className="text-purple-400/80" />;
      case "html": return <FileCode size={13} className="text-red-400/80" />;
      default: return <FileType size={13} className="text-white/30" />;
    }
  };

  const handleContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      targetPath: path
    });
  };

  const contextMenuItems: ContextMenuItem[] = contextMenu ? [
    {
      label: t('tab.close'),
      icon: <X size={14} />,
      shortcut: "Ctrl+F4",
      onClick: () => closeFile(contextMenu.targetPath)
    },
    { separator: true },
    {
      label: t('tab.close_others'),
      icon: <CircleOff size={14} />,
      onClick: () => closeOthers(contextMenu.targetPath)
    },
    {
      label: t('tab.close_to_right'),
      icon: <ArrowRight size={14} />,
      onClick: () => closeToTheRight(contextMenu.targetPath)
    },
    {
      label: t('tab.close_saved'),
      icon: <FileCheck size={14} />,
      shortcut: "Ctrl+K U",
      onClick: () => closeSaved()
    },
    {
      label: t('tab.close_all'),
      icon: <Trash2 size={14} />,
      shortcut: "Ctrl+K W",
      onClick: () => closeAll()
    }
  ] : [];

  // Keyboard handler for the roving tablist. Enter/Space activate the focused
  // tab as before; ArrowLeft/Right move focus+selection with wrap-around, and
  // Home/End jump to the first/last tab. Focus is moved by calling `.focus()`
  // on the destination element after state updates — `tabIndex={-1}` does not
  // block programmatic focus.
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, file: FileState) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setCurrentFile(file);
      return;
    }
    const idx = openFiles.findIndex(f => f.path === file.path);
    if (idx === -1) return;
    const len = openFiles.length;
    let nextIdx: number | null = null;
    if (e.key === "ArrowLeft") nextIdx = (idx - 1 + len) % len;
    else if (e.key === "ArrowRight") nextIdx = (idx + 1) % len;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = len - 1;
    if (nextIdx === null) return;
    e.preventDefault();
    const nextFile = openFiles[nextIdx];
    setCurrentFile(nextFile);
    document.getElementById(tabIdFor(nextFile.path))?.focus();
  };

  if (openFiles.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label={t('tabbar.label')}
      className="flex bg-[#0f0f0f] h-[36px] overflow-x-auto scrollbar-none border-b border-[#1a1a1a] shrink-0"
    >
      {openFiles.map((file) => {
        const isActive = currentFile?.path === file.path;
        return (
          <div
            key={file.path}
            id={tabIdFor(file.path)}
            role="tab"
            aria-selected={isActive}
            aria-controls={EDITOR_TABPANEL_ID}
            aria-label={file.isModified ? `${file.name} (${t('tab.modified', { defaultValue: 'unsaved' })})` : file.name}
            tabIndex={isActive ? 0 : -1}
            onClick={() => setCurrentFile(file)}
            onKeyDown={(e) => handleTabKeyDown(e, file)}
            onContextMenu={(e) => handleContextMenu(e, file.path)}
            className={`relative flex items-center gap-2 px-3 min-w-[100px] max-w-[180px] h-full cursor-pointer transition-all border-r border-[#1a1a1a] group focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40 ${
              isActive
                ? "bg-[#141414] text-white"
                : "text-[#666] hover:text-[#999] hover:bg-[#111]"
            }`}
          >
            {isActive && <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-[1px] bg-white/40" />}

            <div aria-hidden="true" className="shrink-0">{getFileIcon(file)}</div>

            <span className="text-[11px] truncate flex-1">
              {file.name}
            </span>

            {file.isModified && (
              <div aria-hidden="true" className="w-[6px] h-[6px] rounded-full bg-white/40 shrink-0" />
            )}

            <button
              onClick={(e) => { e.stopPropagation(); closeFile(file.path); }}
              aria-label={t('tab.close_aria', { file: file.name })}
              className={`p-0.5 rounded hover:bg-white/10 transition-opacity shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                isActive ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100 focus-visible:opacity-100"
              }`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

export default TabBar;
