import React, { createContext, useContext, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";

interface CollaborationContextType {
  isCollaborating: boolean;
  role: "host" | "guest" | null;
  joinSecret: string | null;
  activeUsers: any[];
  ydoc: Y.Doc | null;
  provider: WebrtcProvider | null;
  acceptJoin: (userId: string) => Promise<void>;
  rejectJoin: (userId: string) => Promise<void>;
  startHostSession: () => void;
}

const CollaborationContext = createContext<CollaborationContextType | null>(null);

export function CollaborationProvider({ children }: { children: React.ReactNode }) {
  const [isCollaborating, setIsCollaborating] = useState(false);
  const [role, setRole] = useState<"host" | "guest" | null>(null);
  const [joinSecret, setJoinSecret] = useState<string | null>(null);
  const [activeUsers, setActiveUsers] = useState<any[]>([]);
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<WebrtcProvider | null>(null);

  useEffect(() => {
    // Check for initial join secret from CLI
    invoke<string | null>("get_initial_join_secret").then((secret) => {
      if (secret) {
        console.log("[Collaboration] Started with join secret:", secret);
        setJoinSecret(secret);
        setRole("guest");
        setIsCollaborating(true);
        toast.info("Joining collaboration session...");
        // Here we would trigger the actual P2P/Relay connection
      }
    });

    // Listen for Discord RPC events
    const unlisten = listen("discord-rpc-event", (event: any) => {
      const { evt, data } = event.payload;

      if (evt === "ACTIVITY_JOIN_REQUEST") {
        const { user } = data;
        toast(`${user.username} wants to join your session`, {
          description: "Do you want to allow them to edit your workspace?",
          action: {
            label: "Accept",
            onClick: () => acceptJoin(user.id),
          },
          cancel: {
            label: "Reject",
            onClick: () => rejectJoin(user.id),
          },
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

    console.log(`[Collaboration] Initializing Yjs session as ${role} for room: ${joinSecret}`);
    const doc = new Y.Doc();
    
    // In a real app, you'd use your own signaling server
    const webrtcProvider = new WebrtcProvider(joinSecret, doc, {
      signaling: ["wss://signaling.yjs.dev"],
    });

    webrtcProvider.on("peers", (params: any) => {
      setActiveUsers(Array.from(webrtcProvider.awareness.getStates().values()));
    });

    setYdoc(doc);
    setProvider(webrtcProvider);

    return () => {
      webrtcProvider.destroy();
      doc.destroy();
      setYdoc(null);
      setProvider(null);
    };
  }, [isCollaborating, joinSecret, role]);

  const startHostSession = () => {
    // Host generates a secret and starts waiting for requests
    const secret = `trixty-room-${Math.random().toString(36).substring(7)}`;
    setJoinSecret(secret);
    setRole("host");
    setIsCollaborating(true);
    toast.success("Collaboration session started!");
  };

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
