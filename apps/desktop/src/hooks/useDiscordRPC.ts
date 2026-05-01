import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useFiles } from "@/context/FilesContext";
import { useWorkspace } from "@/context/WorkspaceContext";

export function useDiscordRPC() {
  const { currentFile } = useFiles();
  const { rootPath } = useWorkspace();
  const lastUpdate = useRef<string>("");
  const startTime = useRef<number>(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const updatePresence = async () => {
      try {
        const folderName = rootPath ? rootPath.split(/[\\/]/).pop() || rootPath : "No Workspace";
        const fileName = currentFile ? currentFile.name : "Idling";
        
        const updateKey = `${folderName}-${fileName}`;
        if (updateKey === lastUpdate.current) return;
        lastUpdate.current = updateKey;

        const details = currentFile ? `Editing ${fileName}` : "Idling";
        const state = rootPath ? `Workspace: ${folderName}` : "No Workspace";

        await invoke("set_discord_activity", {
          activity: {
            type: 3, // 3 = Watching (Viendo)
            details,
            state,
            timestamps: {
              start: startTime.current,
            },
            assets: {
              large_image: "logo",
              large_text: "Trixty IDE",
              small_image: currentFile ? "file" : undefined,
              small_text: currentFile ? `Editing ${fileName}` : undefined,
            },
            party: {
              id: "trixty-session",
              size: [1, 1],
            },
            secrets: {
              spectate: "dummy-spectate-token",
              join: "dummy-join-token",
            },
          },
        });
      } catch (err) {
        console.warn("[Discord RPC] Failed to update presence:", err);
      }
    };

    const timer = setTimeout(updatePresence, 1000); // Debounce to 1s
    return () => clearTimeout(timer);
  }, [currentFile, rootPath]);
}
