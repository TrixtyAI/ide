"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import { trixtyStore } from "@/api/store";
import { logger } from "@/lib/logger";

export interface ChatMessage {
  role: "user" | "ai" | "tool" | "warning";
  text: string;
  thinking?: string; // Reasoning trace
  tool_calls?: { function: { name: string; arguments: Record<string, string | number | boolean | string[]> }; id: string; type: string }[];
  tool_id?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  lastModified: number;
}

interface ChatContextType {
  chatSessions: ChatSession[];
  activeSessionId: string | null;
  createSession: () => void;
  deleteSession: (id: string) => void;
  switchSession: (id: string) => void;
  addMessageToSession: (sessionId: string, message: ChatMessage) => void;
  /**
   * Streaming hook: update the last message in a session when it is an
   * assistant (`role: "ai"`) entry produced by the current stream.
   */
  appendToLastAiMessage: (sessionId: string, delta: string) => void;
  /**
   * Finalizer counterpart to `appendToLastAiMessage`. Callers hand in the
   * authoritative `text` / `thinking` from the stream's `done` chunk.
   */
  finalizeLastAiMessage: (sessionId: string, patch: { text?: string; thinking?: string }) => void;
  /** Reset hook used by `useResetApp`. */
  resetChat: () => void;
}

const CHATS_VERSION = 1;

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const createSession = useCallback(() => {
    const id = Date.now().toString();

    import("@/api/trixty").then(({ trixty }) => {
      const newSession: ChatSession = {
        id,
        title: "Nuevo Chat",
        messages: [{ role: "ai", text: trixty.l10n.t("ai.greeting") }],
        lastModified: Date.now(),
      };
      setChatSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(id);
    });
  }, []);

  // Load chats on mount.
  useEffect(() => {
    (async () => {
      try {
        const savedChats = await trixtyStore.getVersioned<ChatSession[] | null>(
          "trixty-chats",
          CHATS_VERSION,
          null,
        );
        if (savedChats && savedChats.length > 0) {
          setChatSessions(savedChats);
          setActiveSessionId(savedChats[0].id);
        } else {
          // Ensure at least one session exists
          createSession();
        }
      } catch (err) {
        logger.error("[ChatContext] Error loading chats:", err);
      } finally {
        setIsLoaded(true);
      }
    })();
  }, [createSession]);

  // Persist chats. Writes are debounced by 300 ms via effect cleanup: a burst
  // of rapid appends (streaming deltas) coalesces into a single persisted
  // write instead of firing once per token.
  const PERSIST_DEBOUNCE_MS = 300;
  useEffect(() => {
    if (!isLoaded) return;
    if (chatSessions.length === 0) return;
    const handle = setTimeout(() => {
      trixtyStore.setVersioned("trixty-chats", chatSessions, CHATS_VERSION);
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [chatSessions, isLoaded]);

  const deleteSession = useCallback((id: string) => {
    setChatSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (activeSessionId === id && filtered.length > 0) {
        setActiveSessionId(filtered[0].id);
      }
      return filtered;
    });
  }, [activeSessionId]);

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const addMessageToSession = useCallback((sessionId: string, message: ChatMessage) => {
    setChatSessions((prev) => prev.map((s) => {
      if (s.id === sessionId) {
        // Update title if it was "Nuevo Chat"
        let newTitle = s.title;
        if (s.title === "Nuevo Chat" && message.role === "user") {
          newTitle = message.text.slice(0, 30) + (message.text.length > 30 ? "..." : "");
        }
        return {
          ...s,
          title: newTitle,
          messages: [...s.messages, message],
          lastModified: Date.now(),
        };
      }
      return s;
    }));
  }, []);

  // Progressive update for streamed assistant responses. Only mutates the
  // last message if it is an AI entry (placeholder already pushed by the
  // streaming caller). Ignored otherwise so a delta arriving after the chat
  // has moved on (session switch, new user message) cannot corrupt history.
  const appendToLastAiMessage = useCallback((sessionId: string, delta: string) => {
    if (!delta) return;
    setChatSessions((prev) => prev.map((s) => {
      if (s.id !== sessionId) return s;
      if (s.messages.length === 0) return s;
      const last = s.messages[s.messages.length - 1];
      if (last.role !== "ai") return s;
      const updated: ChatMessage = { ...last, text: last.text + delta };
      return {
        ...s,
        messages: [...s.messages.slice(0, -1), updated],
        lastModified: Date.now(),
      };
    }));
  }, []);

  const finalizeLastAiMessage = useCallback(
    (sessionId: string, patch: { text?: string; thinking?: string }) => {
      setChatSessions((prev) => prev.map((s) => {
        if (s.id !== sessionId) return s;
        if (s.messages.length === 0) return s;
        const last = s.messages[s.messages.length - 1];
        if (last.role !== "ai") return s;
        const updated: ChatMessage = {
          ...last,
          text: patch.text !== undefined ? patch.text : last.text,
          thinking: patch.thinking !== undefined ? patch.thinking : last.thinking,
        };
        return {
          ...s,
          messages: [...s.messages.slice(0, -1), updated],
          lastModified: Date.now(),
        };
      }));
    },
    [],
  );

  const resetChat = useCallback(() => {
    setChatSessions([]);
    setActiveSessionId(null);
  }, []);

  const value = useMemo(() => ({
    chatSessions,
    activeSessionId,
    createSession,
    deleteSession,
    switchSession,
    addMessageToSession,
    appendToLastAiMessage,
    finalizeLastAiMessage,
    resetChat,
  }), [
    chatSessions,
    activeSessionId,
    createSession,
    deleteSession,
    switchSession,
    addMessageToSession,
    appendToLastAiMessage,
    finalizeLastAiMessage,
    resetChat,
  ]);

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChat must be used within a ChatProvider");
  return context;
};
