"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { trixtyStore } from "@/api/store";

export interface FileState {
  path: string;
  name: string;
  content: string;
  isModified: boolean;
  language: string;
  type?: "file" | "virtual" | "binary";
}

interface AppContextType {
  openFiles: FileState[];
  currentFile: FileState | null;
  activeSidebarTab: string;
  isSidebarOpen: boolean;
  isRightPanelOpen: boolean;
  isBottomPanelOpen: boolean;
  isSettingsOpen: boolean;
  rootPath: string | null;
  locale: string;

  setLocale: (locale: string) => void;

  openFile: (path: string, name: string, content: string, type?: "file" | "virtual" | "binary") => void;
  closeFile: (path: string) => void;
  closeOthers: (path: string) => void;
  closeToTheRight: (path: string) => void;
  closeSaved: () => void;
  closeAll: () => void;
  setCurrentFile: (file: FileState | null) => void;
  updateFileContent: (path: string, content: string) => void;
  saveCurrentFile: () => Promise<void>;
  setRightPanelOpen: (open: boolean) => void;
  setActiveSidebarTab: (tab: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setRootPath: (path: string | null) => void;
  setBottomPanelOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  handleOpenFolder: () => Promise<void>;
  openTerminal: (path: string) => void;
  terminalPath: string | null;

  // Chat Sessions
  chatSessions: ChatSession[];
  activeSessionId: string | null;
  createSession: () => void;
  deleteSession: (id: string) => void;
  switchSession: (id: string) => void;
  addMessageToSession: (sessionId: string, message: ChatMessage) => void;

  // AI Settings
  aiSettings: AISettings;
  updateAISettings: (settings: Partial<AISettings>) => void;

  // Editor Appearance Settings
  editorSettings: EditorSettings;
  updateEditorSettings: (settings: Partial<EditorSettings>) => void;

  // System Settings
  systemSettings: SystemSettings;
  updateSystemSettings: (settings: Partial<SystemSettings>) => void;
  isInitialLoadComplete: boolean;
  resetApp: () => Promise<void>;
}

export interface SystemSettings {
  hasCompletedOnboarding: boolean;
  filesExclude: string[];
}

export interface AISettings {
  temperature: number;
  systemPrompt: string;
  endpoint: string;
  maxTokens: number;
  alwaysAllowTools: boolean;
  freezeProtection: boolean;
  deepMode: boolean;
  keepAlive: number;
  loadOnStartup: boolean;
}

export interface EditorSettings {
  fontSize: number;
  fontFamily: string;
  theme: string;
  lineHeight: number;
}

export interface ChatMessage {
  role: "user" | "ai" | "tool" | "warning";
  text: string;
  thinking?: string; // Reasoning trace
  tool_calls?: { function: { name: string, arguments: Record<string, string | number | boolean | string[]> }; id: string; type: string }[];
  tool_id?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  lastModified: number;
}

const DEFAULT_AI_SETTINGS: AISettings = {
  temperature: 0.7,
  systemPrompt: "You are Trixty AI, an expert technical programming assistant. Help the user write clean, efficient, and secure code.",
  endpoint: "http://127.0.0.1:11434",
  maxTokens: 2048,
  alwaysAllowTools: false,
  freezeProtection: true,
  deepMode: false,
  keepAlive: 5,
  loadOnStartup: false,
};

const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 14,
  fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
  theme: "trixty-dark",
  lineHeight: 21,
};

const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  hasCompletedOnboarding: false,
  filesExclude: [
    '**/.git',
    '**/.svn',
    '**/.hg',
    '**/.DS_Store',
    '**/Thumbs.db',
    '**/.classpath',
    '**/.factorypath',
    '**/.project',
    '**/.settings',
    '**/node_modules',
    '**/yarn.lock'
  ],
};

const getLanguageFromExtension = (filename: string) => {
  const ext = filename.split(".").pop()?.toLowerCase();

  // Use dynamic LanguageRegistry if available
  if (typeof window !== 'undefined' && window.trixty?.languages) {
    const dynamicLang = window.trixty.languages.getLanguageByExtension(ext || "");
    if (dynamicLang) return dynamicLang;
  }

  // Fallback map for essential file types if Registry hasn't initialized or for defaults
  const map: Record<string, string> = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    json: "json", md: "markdown", txt: "plaintext"
  };
  return map[ext!] || "plaintext";
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [openFiles, setOpenFiles] = useState<FileState[]>([]);
  const [currentFile, setCurrentFile] = useState<FileState | null>(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState("explorer");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(false);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [locale, setLocaleState] = useState("en");
  const [terminalPath, setTerminalPath] = useState<string | null>(null);

  // Chat State
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // AI Settings State
  const [aiSettings, setAiSettings] = useState<AISettings>(DEFAULT_AI_SETTINGS);

  // Editor Settings State
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);

  const [systemSettings, setSystemSettings] = useState<SystemSettings>(DEFAULT_SYSTEM_SETTINGS);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);

  const getSystemDefaultLocale = useCallback(() => {
    return 'en';
  }, []);

  const updateSystemSettings = useCallback((newSettings: Partial<SystemSettings>) => {
    setSystemSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

  const setLocale = useCallback(async (newLocale: string) => {
    const { trixty } = await import("@/api/trixty");
    const oldSystemPrompt = trixty.l10n.t('ai.system_prompt');

    setLocaleState(newLocale);
    await trixtyStore.set("trixty-locale", newLocale);
    trixty.l10n.setLocale(newLocale);

    // Update system prompt if it was the default one
    setAiSettings(prev => {
      if (prev.systemPrompt === oldSystemPrompt) {
        return { ...prev, systemPrompt: trixty.l10n.t('ai.system_prompt') };
      }
      return prev;
    });
  }, []);

  const createSession = useCallback(() => {
    const id = Date.now().toString();

    import("@/api/trixty").then(({ trixty }) => {
      const newSession: ChatSession = {
        id,
        title: "Nuevo Chat",
        messages: [{ role: "ai", text: trixty.l10n.t('ai.greeting') }],
        lastModified: Date.now(),
      };
      setChatSessions(prev => [newSession, ...prev]);
      setActiveSessionId(id);
    });
  }, []);

  // Load settings on mount
  useEffect(() => {
    const loadInitialState = async () => {
      console.log("[AppContext] Starting to load initial state from store...");
      try {
        // 1. Load AI Settings
        const savedSettings = await trixtyStore.get<AISettings | null>("trixty-ai-settings", null);
        console.log("[AppContext] AI Settings loaded:", !!savedSettings);
        if (savedSettings) {
          setAiSettings(prev => ({ ...prev, ...savedSettings }));
        } else {
          // Fallback: translate the default system prompt if no settings found
          const { trixty } = await import("@/api/trixty");
          setAiSettings(prev => ({ ...prev, systemPrompt: trixty.l10n.t('ai.system_prompt') }));
        }

        // 2. Load Chats
        const savedChats = await trixtyStore.get<ChatSession[] | null>("trixty-chats", null);
        console.log("[AppContext] Chats loaded:", savedChats?.length || 0);
        if (savedChats && savedChats.length > 0) {
          setChatSessions(savedChats);
          setActiveSessionId(savedChats[0].id);
        } else {
          // Ensure at least one session exists
          createSession();
        }

        // 3. Load Locale
        const savedLocale = await trixtyStore.get<string | null>("trixty-locale", null);
        console.log("[AppContext] Locale loaded:", savedLocale);
        if (savedLocale) {
          setLocale(savedLocale);
        } else {
          // Detect system language
          const detectedLocale = getSystemDefaultLocale();
          console.log("[AppContext] No saved locale found. Detected default:", detectedLocale);
          setLocale(detectedLocale);
        }
         // 4. Load Editor Settings
        const savedEditorSettings = await trixtyStore.get<EditorSettings | null>("trixty-editor-settings", null);
        console.log("[AppContext] Editor Settings loaded:", !!savedEditorSettings);
        if (savedEditorSettings) {
          setEditorSettings(savedEditorSettings);
        }

        // 5. Load System Settings
        const savedSystemSettings = await trixtyStore.get<SystemSettings | null>("trixty-system-settings", null);
        console.log("[AppContext] System Settings loaded:", !!savedSystemSettings);
        if (savedSystemSettings) {
          setSystemSettings(prev => ({ ...prev, ...savedSystemSettings }));
        }

        setIsInitialLoadComplete(true);
        console.log("[AppContext] Initial load complete.");
      } catch (err) {
        console.error("[AppContext] Error loading initial state:", err);
        // Even on error, we should probably allow saving new changes
        setIsInitialLoadComplete(true);
      }
    };

    loadInitialState();
  }, [createSession, setLocale]);

  // Global: Remove default context menu
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  // Persistence effects - ONLY run after initial load to avoid overwriting store with defaults
  useEffect(() => {
    if (!isInitialLoadComplete) return;
    if (chatSessions.length > 0) {
      trixtyStore.set("trixty-chats", chatSessions);
    }
  }, [chatSessions, isInitialLoadComplete]);

  useEffect(() => {
    if (!isInitialLoadComplete) return;
    trixtyStore.set("trixty-ai-settings", aiSettings);
  }, [aiSettings, isInitialLoadComplete]);

  useEffect(() => {
    if (!isInitialLoadComplete) return;
    trixtyStore.set("trixty-editor-settings", editorSettings);
  }, [editorSettings, isInitialLoadComplete]);

  useEffect(() => {
    if (!isInitialLoadComplete) return;
    trixtyStore.set("trixty-system-settings", systemSettings);
  }, [systemSettings, isInitialLoadComplete]);

  const updateAISettings = useCallback((newSettings: Partial<AISettings>) => {
    setAiSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

  const updateEditorSettings = useCallback((newSettings: Partial<EditorSettings>) => {
    setEditorSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

  const deleteSession = useCallback((id: string) => {
    setChatSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (activeSessionId === id && filtered.length > 0) {
        setActiveSessionId(filtered[0].id);
      } else if (filtered.length === 0) {
        // We'll create a new one after
      }
      return filtered;
    });
  }, [activeSessionId]);

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const addMessageToSession = useCallback((sessionId: string, message: ChatMessage) => {
    setChatSessions(prev => prev.map(s => {
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
          lastModified: Date.now()
        };
      }
      return s;
    }));
  }, []);

  const openTerminal = useCallback((path: string) => {
    setTerminalPath(prev => prev === path ? prev : path); // no-op if same path
    setIsBottomPanelOpen(true);
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
      const index = prev.findIndex(f => f.path === path);
      if (index === -1) return prev;
      const newFiles = prev.slice(0, index + 1);
      
      // If current file was to the right, switch to the target tab
      if (currentFile && prev.findIndex(f => f.path === currentFile.path) > index) {
        setCurrentFile(newFiles[index]);
      }
      
      return newFiles;
    });
  }, [currentFile]);

  const closeSaved = useCallback(() => {
    setOpenFiles((prev) => {
      const newFiles = prev.filter(f => f.isModified);
      
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
        f.path === path ? { ...f, content, isModified: true } : f
      )
    );
    if (currentFile?.path === path) {
      setCurrentFile((prev) => (prev ? { ...prev, content, isModified: true } : null));
    }
  }, [currentFile]);

  const saveCurrentFile = async () => {
    if (!currentFile) return;
    // Only real file tabs are writable. Virtual tabs have no on-disk path,
    // and binary tabs carry an empty content string that would overwrite the file.
    if (currentFile.type && currentFile.type !== "file") return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_file", { path: currentFile.path, content: currentFile.content });

      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === currentFile.path ? { ...f, isModified: false } : f
        )
      );
      setCurrentFile((prev) => (prev ? { ...prev, isModified: false } : null));
    } catch (error) {
      console.error("Failed to save file:", error);
    }
  };

  const handleOpenFolder = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Project Folder",
      });
      if (selected && typeof selected === "string") {
        setRootPath(selected);
      }
    } catch (err) {
      console.error("Error opening folder dialog:", err);
    }
  }, []);



  const resetApp = useCallback(async () => {
    // 1. Disable persistence during reset to avoid race conditions
    setIsInitialLoadComplete(false);

    // 2. Clear store from disk
    const keys = [
      "trixty-chats",
      "trixty-ai-settings",
      "trixty-locale",
      "trixty-editor-settings",
      "trixty-system-settings",
      "trixty_ai_last_model"
    ];
    for (const key of keys) {
      await trixtyStore.delete(key);
    }

    // 3. Reset all React state to defaults
    setOpenFiles([]);
    setCurrentFile(null);
    setRootPath(null);
    setChatSessions([]);
    setActiveSessionId(null);
    setAiSettings(DEFAULT_AI_SETTINGS);
    setEditorSettings(DEFAULT_EDITOR_SETTINGS);
    setSystemSettings(DEFAULT_SYSTEM_SETTINGS);
    setIsSettingsOpen(false);

    // 4. Force re-detection of language and update L10n engine
    const detectedLocale = getSystemDefaultLocale();
    await setLocale(detectedLocale);

    // 5. Re-enable to trigger onboarding (since hasCompletedOnboarding is now false)
    // We use a small timeout to ensure states have propagated
    setTimeout(() => {
        setIsInitialLoadComplete(true);
    }, 100);
  }, [getSystemDefaultLocale, setLocale]);

  return (
    <AppContext.Provider
      value={{
        openFiles,
        currentFile,
        activeSidebarTab,
        isSidebarOpen,
        isRightPanelOpen,
        isBottomPanelOpen,
        rootPath,
        openFile,
        closeFile,
        closeOthers,
        closeToTheRight,
        closeSaved,
        closeAll,
        setCurrentFile,
        updateFileContent,
        saveCurrentFile,
        setRightPanelOpen: setIsRightPanelOpen,
        setActiveSidebarTab,
        setSidebarOpen: setIsSidebarOpen,
        setBottomPanelOpen: setIsBottomPanelOpen,
        setRootPath,
        handleOpenFolder,
        openTerminal,
        terminalPath,
        chatSessions,
        activeSessionId,
        createSession,
        deleteSession,
        switchSession,
        addMessageToSession,
        isSettingsOpen,
        setSettingsOpen: setIsSettingsOpen,
        aiSettings,
        updateAISettings,
        editorSettings,
        updateEditorSettings,
        systemSettings,
        updateSystemSettings,
        locale,
        setLocale,
        isInitialLoadComplete,
        resetApp,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within an AppProvider");
  return context;
};
