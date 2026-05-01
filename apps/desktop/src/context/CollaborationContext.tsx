"use client";

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useSettings } from "@/context/SettingsContext";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";

interface CollaborationContextType {
  isCollaborating: boolean;
  role: "host" | "guest" | null;
  joinSecret: string | null;
  activeUsers: any[];
  ydoc: Y.Doc;
  provider: WebrtcProvider | null;
  acceptJoin: (userId: string) => Promise<void>;
  rejectJoin: (userId: string) => Promise<void>;
  startHostSession: () => void;
  stopCollaboration: () => void;
  updatePresenceFile: (path: string | null) => void;
}

const CollaborationContext = createContext<CollaborationContextType | null>(null);

export function CollaborationProvider({ children }: { children: React.ReactNode }) {
  const [isCollaborating, setIsCollaborating] = useState(false);
  const [role, setRole] = useState<"host" | "guest" | null>(null);
  const [joinSecret, setJoinSecret] = useState<string | null>(null);
  const [activeUsers, setActiveUsers] = useState<any[]>([]);
  const { systemSettings } = useSettings();
  
  const ydoc = useMemo(() => new Y.Doc(), []);
  const [provider, setProvider] = useState<WebrtcProvider | null>(null);

  const stopCollaboration = useCallback(() => {
    setIsCollaborating(false);
    setRole(null);
    setJoinSecret(null);
    setActiveUsers([]);
    if (provider) {
      provider.destroy();
      setProvider(null);
    }
  }, [provider]);

  const startHostSession = useCallback(() => {
    const secret = `trixty-room-${Math.random().toString(36).substring(7)}`;
    setJoinSecret(secret);
    setRole("host");
    setIsCollaborating(true);
    toast.success("Collaboration session started!");
  }, []);

  useEffect(() => {
    // Check for initial join secret from CLI
    invoke<string | null>("get_initial_join_secret").then((secret) => {
      if (secret) {
        setJoinSecret(secret);
        setRole("guest");
        setIsCollaborating(true);
        toast.info("Joining collaboration session...");
      }
    });

    // Listen for Discord RPC events
    const unlisten = listen("discord-rpc-event", (event: any) => {
      const { evt, data } = event.payload;
      if (evt === "ACTIVITY_JOIN_REQUEST") {
        const { user } = data;
        toast(`${user.username} wants to join your session`, {
          description: "Allow them to edit your workspace?",
          action: { label: "Accept", onClick: () => acceptJoin(user.id) },
          cancel: { label: "Reject", onClick: () => rejectJoin(user.id) },
          duration: 10000,
        });
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Effect to manage Yjs session lifecycle
  useEffect(() => {
    if (!isCollaborating || !joinSecret) return;

    const webrtcProvider = new WebrtcProvider(joinSecret, ydoc, {
      signaling: ["wss://signaling.yjs.dev"],
    });

    // Set local awareness state
    const colors = ["#f87171", "#fb923c", "#fbbf24", "#34d399", "#22d3ee", "#818cf8", "#c084fc", "#f472b6"];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    // In a real app we'd get this from Discord, for now we use a placeholder or random name
    webrtcProvider.awareness.setLocalStateField("user", {
      name: systemSettings.discord?.enabled ? "You" : `User-${Math.floor(Math.random() * 1000)}`,
      color: randomColor,
    });

    webrtcProvider.awareness.on("change", () => {
      setActiveUsers(Array.from(webrtcProvider.awareness.getStates().values()));
    });

    setProvider(webrtcProvider);

    return () => {
      webrtcProvider.destroy();
      setProvider(null);
    };
  }, [isCollaborating, joinSecret, ydoc]);

  // Sync with settings
  useEffect(() => {
    const enabled = systemSettings.discord?.enabled;
    const allowJoin = systemSettings.discord?.allowCollaboration;
    const shouldHost = enabled && allowJoin;
    
    console.log("[Collaboration] Sync Check:", { enabled, allowJoin, shouldHost, isCollaborating, role });
    
    if (shouldHost && !isCollaborating) {
      console.log("[Collaboration] Condition met: Starting Host Session...");
      startHostSession();
    } else if (!shouldHost && isCollaborating && role === "host") {
      console.log("[Collaboration] Condition lost: Stopping Collaboration...");
      stopCollaboration();
    }
  }, [systemSettings.discord?.enabled, systemSettings.discord?.allowCollaboration, isCollaborating, role, startHostSession, stopCollaboration]);

  const acceptJoin = async (userId: string) => {
    try {
      await invoke("accept_discord_join_request", { userId });
      toast.success("Accepted join request");
    } catch (err) {
      toast.error("Failed to accept join request");
    }
  };

  const rejectJoin = async (userId: string) => {
    try {
      await invoke("reject_discord_join_request", { userId });
      toast.info("Rejected join request");
    } catch (err) {
      toast.error("Failed to reject join request");
    }
  };

  const updatePresenceFile = useCallback((path: string | null) => {
    if (provider?.awareness) {
      const currentState = provider.awareness.getLocalState();
      provider.awareness.setLocalStateField("user", {
        ...currentState?.user,
        currentFile: path,
      });
    }
  }, [provider]);

  return (
    <CollaborationContext.Provider
      value={{
        isCollaborating,
        role,
        joinSecret,
        activeUsers,
        ydoc,
        provider,
        acceptJoin,
        rejectJoin,
        startHostSession,
        stopCollaboration,
        updatePresenceFile,
      }}
    >
      {children}
    </CollaborationContext.Provider>
  );
}

export const useCollaboration = () => {
  const ctx = useContext(CollaborationContext);
  if (!ctx) throw new Error("useCollaboration must be used within a CollaborationProvider");
  return ctx;
};
