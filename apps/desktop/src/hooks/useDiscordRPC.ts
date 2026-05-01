import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useFiles } from "@/context/FilesContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useSettings } from "@/context/SettingsContext";
import { useCollaboration } from "@/context/CollaborationContext";

export function useDiscordRPC() {
  const { currentFile } = useFiles();
  const { rootPath } = useWorkspace();
  const lastUpdate = useRef<string>("");
  const startTime = useRef<number>(Math.floor(Date.now() / 1000));

  const { systemSettings } = useSettings();
  const discord = systemSettings.discord;
  const { isCollaborating, joinSecret, role, activeUsers } = useCollaboration();

  useEffect(() => {
    if (!discord?.enabled) {
      lastUpdate.current = "";
      invoke("set_discord_activity", { activity: null }).catch(() => {});
      return;
    }

    const updatePresence = async () => {
      try {
        const folderName = rootPath ? rootPath.split(/[\\/]/).pop() || rootPath : "No Workspace";
        const fileName = currentFile ? currentFile.name : "Idling";
        
        // Include collaboration state in the update key
        const updateKey = `${folderName}-${fileName}-${discord.showDetails}-${discord.allowCollaboration}-${isCollaborating}-${activeUsers.length}`;
        if (updateKey === lastUpdate.current) return;
        lastUpdate.current = updateKey;

        const details = discord.showDetails 
          ? (currentFile ? `Editing ${fileName}` : "Idling")
          : "In Trixty IDE";
        
        const state = discord.showDetails
          ? (rootPath ? `Workspace: ${folderName}` : "No Workspace")
          : undefined;

        // Use the active session secret if we are the host, otherwise use a placeholder
        // which triggers the join request flow.
        const currentJoinSecret = (isCollaborating && role === "host" && joinSecret) 
          ? joinSecret 
          : `join-request-${startTime.current}`;

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
              small_image: (currentFile && discord.showDetails) ? "file" : undefined,
              small_text: (currentFile && discord.showDetails) ? `Editing ${fileName}` : undefined,
            },
            party: discord.allowCollaboration ? {
              id: "trixty-session",
              size: [activeUsers.length + 1, 5],
            } : undefined,
            secrets: discord.allowCollaboration ? {
              spectate: `dummy-spectate-${startTime.current}`,
              join: currentJoinSecret,
            } : undefined,
          },
        });
      } catch (err) {
        console.warn("[Discord RPC] Failed to update presence:", err);
      }
    };

    const timer = setTimeout(updatePresence, 1000); // Debounce to 1s
    return () => clearTimeout(timer);
  }, [currentFile, rootPath, discord, isCollaborating, joinSecret, role, activeUsers.length]);
}
