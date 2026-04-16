"use client";

import React from "react";
import { X, FileCode, FileText, FileJson, FileType, Package } from "lucide-react";
import { useApp, FileState } from "@/context/AppContext";

const TabBar: React.FC = () => {
  const { openFiles, currentFile, setCurrentFile, closeFile } = useApp();

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

  if (openFiles.length === 0) return null;

  return (
    <div className="flex bg-[#0f0f0f] h-[36px] overflow-x-auto scrollbar-none border-b border-[#1a1a1a] shrink-0">
      {openFiles.map((file) => {
        const isActive = currentFile?.path === file.path;
        return (
          <div
            key={file.path}
            onClick={() => setCurrentFile(file)}
            className={`relative flex items-center gap-2 px-3 min-w-[100px] max-w-[180px] h-full cursor-pointer transition-all border-r border-[#1a1a1a] group ${
              isActive
                ? "bg-[#141414] text-white" 
                : "text-[#666] hover:text-[#999] hover:bg-[#111]"
            }`}
          >
            {isActive && <div className="absolute top-0 left-0 right-0 h-[1px] bg-white/40" />}
            
            <div className="shrink-0">{getFileIcon(file)}</div>
            
            <span className="text-[11px] truncate flex-1">
              {file.name}
            </span>

            {file.isModified && (
              <div className="w-[6px] h-[6px] rounded-full bg-white/40 shrink-0" />
            )}

            <button
              onClick={(e) => { e.stopPropagation(); closeFile(file.path); }}
              className={`p-0.5 rounded hover:bg-white/10 transition-opacity shrink-0 ${
                isActive ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
              }`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default TabBar;
