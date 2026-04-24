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

export const FilesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [openFiles, setOpenFiles] = useState<FileState[]>([]);
  const [currentFile, setCurrentFile] = useState<FileState | null>(null);

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
    setOpenFiles((prev) => {
      const existing = prev.find((f) => f.path === path);
      if (existing) {
        setCurrentFile(existing);
        return prev;
      }

      // Enforce 10-tab limit
      const newOpenFiles = [...prev];
      if (newOpenFiles.length >= 10) {
        newOpenFiles.shift(); // Remove the oldest tab
      }

      const newFile: FileState = {
        path,
        name,
        content,
        isModified: false,
        language: getLanguageFromExtension(name),
        type,
      };
      setCurrentFile(newFile);
      return [...newOpenFiles, newFile];
    });
  }, []);

  const closeFile = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const filtered = prev.filter((f) => f.path !== path);
      if (currentFile?.path === path) {
        setCurrentFile(filtered.length > 0 ? filtered[filtered.length - 1] : null);
      }
      return filtered;
    });
  }, [currentFile]);

  const closeOthers = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const newFiles = prev.filter((f) => f.path === path);
      if (currentFile?.path !== path) {
        setCurrentFile(newFiles[0] || null);
      }
      return newFiles;
    });
  }, [currentFile]);

  const closeToTheRight = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const index = prev.findIndex((f) => f.path === path);
      if (index === -1) return prev;
      const newFiles = prev.slice(0, index + 1);

      // If current file was to the right, switch to the target tab
      if (currentFile && prev.findIndex((f) => f.path === currentFile.path) > index) {
        setCurrentFile(newFiles[index]);
      }

      return newFiles;
    });
  }, [currentFile]);

  const closeSaved = useCallback(() => {
    setOpenFiles((prev) => {
      const newFiles = prev.filter((f) => f.isModified);

      // If current file was closed, switch to the first remaining one
      if (currentFile && !currentFile.isModified) {
        setCurrentFile(newFiles.length > 0 ? newFiles[0] : null);
      }

      return newFiles;
    });
  }, [currentFile]);

  const closeAll = useCallback(() => {
    setOpenFiles([]);
    setCurrentFile(null);
  }, []);

  const updateFileContent = useCallback((path: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === path ? { ...f, content, isModified: true } : f,
      ),
    );
    // Perform the path check inside the setter so debounced callers can't
    // overwrite a tab that happens to be active now but wasn't when the edit
    // was made. `updateFileContent` stays stable (no `currentFile` dep) so
    // consumers don't see it change when the active tab changes.
    setCurrentFile((prev) =>
      prev && prev.path === path ? { ...prev, content, isModified: true } : prev,
    );
  }, []);

  const saveCurrentFile = useCallback(async () => {
    if (!currentFile) return;
    // Only real file tabs are writable. Virtual tabs have no on-disk path,
    // and binary tabs carry an empty content string that would overwrite the file.
    if (currentFile.type && currentFile.type !== "file") return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_file", { path: currentFile.path, content: currentFile.content });

      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === currentFile.path ? { ...f, isModified: false } : f,
        ),
      );
      setCurrentFile((prev) => (prev ? { ...prev, isModified: false } : null));
    } catch (error) {
      logger.error("Failed to save file:", error);
    }
  }, [currentFile]);

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
