"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { trixty as trixtyRef } from "@/api/trixty";
import { logger } from "@/lib/logger";
import { isTauri } from "@/api/tauri";

export interface FileState {
  path: string;
  name: string;
  content: string;
  isModified: boolean;
  language: string;
  type?: "file" | "virtual" | "binary";
}

interface FilesContextType {
  openFiles: FileState[];
  currentFile: FileState | null;
  openFile: (path: string, name: string, content: string, type?: "file" | "virtual" | "binary") => void;
  closeFile: (path: string) => void;
  closeOthers: (path: string) => void;
  closeToTheRight: (path: string) => void;
  closeSaved: () => void;
  closeAll: () => void;
  setCurrentFile: (file: FileState | null) => void;
  updateFileContent: (path: string, content: string) => void;
  saveCurrentFile: () => Promise<void>;
}

const FilesContext = createContext<FilesContextType | undefined>(undefined);

const getLanguageFromExtension = (filename: string) => {
  const ext = filename.split(".").pop()?.toLowerCase();

  // Use dynamic LanguageRegistry if available. Imported lazily to keep
  // Monaco off the boot graph — `@/api/trixty` constructs a Monaco
  // loader in its own module init, and this helper runs during the
  // first file-open, well after first paint.
  if (typeof window !== "undefined") {
    try {
      const dynamicLang = trixtyRef?.languages.getLanguageByExtension(ext || "");
      if (dynamicLang) return dynamicLang;
    } catch {
      // Registry not yet initialised — fall through to the static map.
    }
  }

  // Fallback map for essential file types if Registry hasn't initialized or for defaults
  const map: Record<string, string> = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    json: "json", md: "markdown", txt: "plaintext",
  };
  return map[ext!] || "plaintext";
};

interface FilesState {
  openFiles: FileState[];
  currentFile: FileState | null;
}

const normalizePath = (p: string) => p.replace(/\\/g, "/").toLowerCase();

export const FilesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<FilesState>({
    openFiles: [],
    currentFile: null,
  });

  const { openFiles, currentFile } = state;

  // Track openFiles via a ref so the close-requested listener registered once
  // below can always read the latest modified state without re-registering.
  const openFilesRef = useRef(openFiles);
  useEffect(() => {
    openFilesRef.current = openFiles;
  }, [openFiles]);

  // Intercept native close (X button, Alt+F4, system menu) and prompt the user
  // if there are unsaved tabs. `destroy()` bypasses the close-requested event
  // so the subsequent close doesn't re-enter this handler.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const [{ getCurrentWindow }, { ask }, { trixty }] = await Promise.all([
          import("@tauri-apps/api/window"),
          import("@tauri-apps/plugin-dialog"),
          import("@/api/trixty"),
        ]);
        const win = getCurrentWindow();
        const unlistenFn = await win.onCloseRequested(async (event) => {
          const hasUnsaved = openFilesRef.current.some((f) => f.isModified);
          if (!hasUnsaved) return;
          event.preventDefault();
          try {
            const confirmed = await ask(trixty.l10n.t("window.close.unsaved.message"), {
              title: trixty.l10n.t("window.close.unsaved.title"),
              kind: "warning",
              okLabel: trixty.l10n.t("window.close.unsaved.discard"),
              cancelLabel: trixty.l10n.t("window.close.unsaved.cancel"),
            });
            if (confirmed) {
              await win.destroy();
            }
          } catch (e) {
            // If the dialog or destroy pipeline fails, fall back to closing
            // rather than leaving the window stuck with the close prevented.
            logger.error("[FilesContext] close-requested handler failed:", e);
            await win.destroy();
          }
        });
        if (cancelled) unlistenFn();
        else unlisten = unlistenFn;
      } catch {
        // Window / dialog API unavailable — fall back to default close behaviour.
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  const openFile = useCallback((path: string, name: string, content: string, type: "file" | "virtual" | "binary" = "file") => {
    const normalizedPath = normalizePath(path);
    setState((prev) => {
      const existing = prev.openFiles.find((f) => normalizePath(f.path) === normalizedPath);
      if (existing) {
        return { ...prev, currentFile: existing };
      }

      // Enforce 10-tab limit
      const newOpenFiles = [...prev.openFiles];
      if (newOpenFiles.length >= 10) {
        newOpenFiles.shift(); // Remove the oldest tab
      }

      const newFile: FileState = {
        path, // Store original path for disk operations
        name,
        content,
        isModified: false,
        language: getLanguageFromExtension(name),
        type,
      };
      
      return {
        openFiles: [...newOpenFiles, newFile],
        currentFile: newFile,
      };
    });
  }, []);


  const closeFile = useCallback((path: string) => {
    const normalizedTarget = normalizePath(path);
    setState((prev) => {
      const filtered = prev.openFiles.filter((f) => normalizePath(f.path) !== normalizedTarget);
      let nextCurrent = prev.currentFile;
      
      if (prev.currentFile && normalizePath(prev.currentFile.path) === normalizedTarget) {
        nextCurrent = filtered.length > 0 ? filtered[filtered.length - 1] : null;
      }
      
      return {
        openFiles: filtered,
        currentFile: nextCurrent,
      };
    });
  }, []);

  const closeOthers = useCallback((path: string) => {
    const normalizedTarget = normalizePath(path);
    setState((prev) => {
      const newFiles = prev.openFiles.filter((f) => normalizePath(f.path) === normalizedTarget);
      let nextCurrent = prev.currentFile;
      
      if (prev.currentFile && normalizePath(prev.currentFile.path) !== normalizedTarget) {
        nextCurrent = newFiles[0] || null;
      }
      
      return {
        openFiles: newFiles,
        currentFile: nextCurrent,
      };
    });
  }, []);

  const closeToTheRight = useCallback((path: string) => {
    const normalizedTarget = normalizePath(path);
    setState((prev) => {
      const index = prev.openFiles.findIndex((f) => normalizePath(f.path) === normalizedTarget);
      if (index === -1) return prev;
      
      const newFiles = prev.openFiles.slice(0, index + 1);
      let nextCurrent = prev.currentFile;

      // If current file was to the right, switch to the target tab
      if (prev.currentFile && prev.openFiles.findIndex((f) => normalizePath(f.path) === normalizePath(prev.currentFile!.path)) > index) {
        nextCurrent = newFiles[index];
      }

      return {
        openFiles: newFiles,
        currentFile: nextCurrent,
      };
    });
  }, []);

  const closeSaved = useCallback(() => {
    setState((prev) => {
      const newFiles = prev.openFiles.filter((f) => f.isModified);
      let nextCurrent = prev.currentFile;

      // If current file was closed, switch to the first remaining one
      if (prev.currentFile && !prev.currentFile.isModified) {
        nextCurrent = newFiles.length > 0 ? newFiles[0] : null;
      }

      return {
        openFiles: newFiles,
        currentFile: nextCurrent,
      };
    });
  }, []);

  const closeAll = useCallback(() => {
    setState({
      openFiles: [],
      currentFile: null,
    });
  }, []);

  const setCurrentFile = useCallback((file: FileState | null) => {
    if (!file) {
      setState((prev) => ({ ...prev, currentFile: null }));
      return;
    }
    const normalizedPath = normalizePath(file.path);
    setState((prev) => {
      const exists = prev.openFiles.find((f) => normalizePath(f.path) === normalizedPath);
      return { ...prev, currentFile: exists || prev.currentFile };
    });
  }, []);

  const updateFileContent = useCallback((path: string, content: string) => {
    const normalizedPath = normalizePath(path);
    setState((prev) => {
      const nextOpenFiles = prev.openFiles.map((f) =>
        normalizePath(f.path) === normalizedPath ? { ...f, content, isModified: true } : f,
      );
      
      let nextCurrent = prev.currentFile;
      if (prev.currentFile && normalizePath(prev.currentFile.path) === normalizedPath) {
        nextCurrent = { ...prev.currentFile, content, isModified: true };
      }
      
      return {
        openFiles: nextOpenFiles,
        currentFile: nextCurrent,
      };
    });
  }, []);


  const saveCurrentFile = useCallback(async () => {
    // Access current state via a ref-like pattern if needed, but since this is async, 
    // we should probably just use the closure's currentFile if it's stable enough,
    // or better, check the state inside the callback if we can.
    // However, the existing logic used the currentFile from the closure.
    // Let's use a functional update to get the latest state safely.
    
    let targetFile: FileState | null = null;
    setState(prev => {
      targetFile = prev.currentFile;
      return prev;
    });

    if (!targetFile) return;
    const file = targetFile as FileState;
    
    // Only real file tabs are writable. Virtual tabs have no on-disk path,
    // and binary tabs carry an empty content string that would overwrite the file.
    if (file.type && file.type !== "file") return;
    
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_file", { path: file.path, content: file.content });

      setState((prev) => {
        const nextOpenFiles = prev.openFiles.map((f) =>
          normalizePath(f.path) === normalizePath(file.path) ? { ...f, isModified: false } : f,
        );
        
        let nextCurrent = prev.currentFile;
        if (prev.currentFile && normalizePath(prev.currentFile.path) === normalizePath(file.path)) {
          nextCurrent = { ...prev.currentFile, isModified: false };
        }
        
        return {
          openFiles: nextOpenFiles,
          currentFile: nextCurrent,
        };
      });

    } catch (error) {
      logger.error("Failed to save file:", error);
    }
  }, []);


  const value = useMemo(() => ({
    openFiles,
    currentFile,
    openFile,
    closeFile,
    closeOthers,
    closeToTheRight,
    closeSaved,
    closeAll,
    setCurrentFile,
    updateFileContent,
    saveCurrentFile,
  }), [
    openFiles,
    currentFile,
    openFile,
    closeFile,
    closeOthers,
    closeToTheRight,
    closeSaved,
    closeAll,
    setCurrentFile,
    updateFileContent,
    saveCurrentFile,
  ]);

  return (
    <FilesContext.Provider value={value}>
      {children}
    </FilesContext.Provider>
  );
};

export const useFiles = () => {
  const context = useContext(FilesContext);
  if (!context) throw new Error("useFiles must be used within a FilesProvider");
  return context;
};
