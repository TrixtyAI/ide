import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useCollaboration } from "@/context/CollaborationContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { logger } from "@/lib/logger";

import * as Y from "yjs";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

export function useWorkspaceSync() {
  const { isCollaborating, role, ydoc } = useCollaboration();
  const { rootPath } = useWorkspace();


  const syncDirectory = useCallback(async (path: string, map: Y.Map<unknown>) => {
    try {
      const data = await invoke<FileEntry[]>("read_directory", { path });
      
      // We only sync the top-level or whatever is needed. 
      // For a better experience, we should sync expanded dirs.
      // But for a start, let's just sync everything or the requested path.
      
      map.set(path, data);

      // Deep sync? Careful with performance on large repos.
      // In a real IDE, we'd only sync what's visible or use a more efficient protocol.
    } catch (err) {
      logger.error("[WorkspaceSync] Failed to sync directory:", path, err);
    }
  }, []);

  useEffect(() => {
    if (!isCollaborating || role !== "host" || !ydoc || !rootPath) return;

    const workspaceMap = ydoc.getMap("workspace");
    const fileRequests = ydoc.getMap("file-requests");

    workspaceMap.set("rootPath", rootPath);

    // Initial sync of the root
    syncDirectory(rootPath, workspaceMap);

    // Listen for file requests from guests
    const requestObserver = async (event: Y.YMapEvent<unknown>) => {
      for (const [path, action] of event.keys) {
        if (action.action === "add" || action.action === "update") {
          const req = fileRequests.get(path);
          if (!req) continue;

          try {
            const content = await invoke<string>("read_file", { path });
            const sharedText = ydoc.getText(`file:${path}`);
            
            // Only populate if empty to avoid overwriting current edits
            if (sharedText.length === 0) {
              sharedText.insert(0, content);
            }
          } catch (err) {
            logger.error("[WorkspaceSync] Failed to fulfill file request:", path, err);
          }
        }
      }
    };

    fileRequests.observe(requestObserver);
    return () => fileRequests.unobserve(requestObserver);
  }, [isCollaborating, role, ydoc, rootPath, syncDirectory]);
}
