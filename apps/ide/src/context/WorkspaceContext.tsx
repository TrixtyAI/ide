"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { isTauri, safeInvoke } from "@/api/tauri";
import { logger } from "@/lib/logger";

interface WorkspaceContextType {
  rootPath: string | null;
  setRootPath: (path: string | null) => Promise<void>;
  handleOpenFolder: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [rootPath, _setRootPath] = useState<string | null>(null);

  // Public `setRootPath` wrapper that syncs the Rust-side workspace guard
  // BEFORE committing the React state. Every filesystem command (`read_file`,
  // `write_file`, `read_directory`, `create_directory`, `delete_path`) runs a
  // containment check against this root; returning early on failure avoids a
  // window where components re-render with the new rootPath but the backend
  // still guards against the old one (or no workspace at all), causing every
  // fs call to be rejected until the sync catches up.
  const setRootPath = useCallback(async (path: string | null): Promise<void> => {
    if (isTauri()) {
      try {
        await safeInvoke("set_workspace_root", { path });
      } catch (e) {
        logger.error("[WorkspaceContext] Failed to sync workspace root with Rust:", e);
        return;
      }
    }
    _setRootPath(path);
  }, []);

  const handleOpenFolder = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Project Folder",
      });
      if (selected && typeof selected === "string") {
        await setRootPath(selected);
      }
    } catch (err) {
      logger.error("Error opening folder dialog:", err);
    }
  }, [setRootPath]);

  // If the user launched via `tide <path>` (or `TrixtyIDE --path <path>`),
  // Rust has already validated and canonicalised that path. Take it out of
  // managed state here — `take_initial_cli_workspace` is a one-shot consumer,
  // so a subsequent webview reload won't re-apply a stale CLI value on top of
  // a manually-picked folder.
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const cliPath = await safeInvoke("take_initial_cli_workspace");
        if (cliPath) {
          logger.debug("[WorkspaceContext] Opening CLI-supplied workspace:", cliPath);
          await setRootPath(cliPath);
        }
      } catch (e) {
        // Non-fatal: the user can still open a folder manually.
        logger.warn("[WorkspaceContext] Failed to read CLI workspace path:", e);
      }
    })();
  }, [setRootPath]);

  return (
    <WorkspaceContext.Provider value={{ rootPath, setRootPath, handleOpenFolder }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return context;
};
