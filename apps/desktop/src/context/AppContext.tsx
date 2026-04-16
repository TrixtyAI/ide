"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

export interface FileState {
  path: string;
  name: string;
  content: string;
  isModified: boolean;
  language: string;
  type?: "file" | "virtual";
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

  openFile: (path: string, name: string, content: string, type?: "file" | "virtual") => void;
  closeFile: (path: string) => void;
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
}

export interface SystemSettings {
  updateChannel: "stable" | "insiders";
}

export interface AISettings {
  temperature: number;
  systemPrompt: string;
  endpoint: string;
  maxTokens: number;
  alwaysAllowTools: boolean;
  freezeProtection: boolean;
  deepMode: boolean;
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
  const [aiSettings, setAiSettings] = useState<AISettings>({
    temperature: 0.7,
    systemPrompt: "Eres Trixty AI, un asistente de programación experto, conciso y técnico. Ayuda al usuario a escribir código limpio y eficiente.",
    endpoint: "http://localhost:11434",
    maxTokens: 2048,
    alwaysAllowTools: false,
    freezeProtection: true,
    deepMode: false,
  });

  // Editor Settings State
  const [editorSettings, setEditorSettings] = useState<EditorSettings>({
    fontSize: 20,
    fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
    theme: "trixty-dark",
    lineHeight: 24,
  });

  // System Settings State
  const [systemSettings, setSystemSettings] = useState<SystemSettings>({
    updateChannel: "stable",
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Load chats on mount
  useEffect(() => {
    // Load chats
    const savedChats = localStorage.getItem("trixty-chats");
    if (savedChats) {
      try {
        const parsed = JSON.parse(savedChats);
        setChatSessions(parsed);
        if (parsed.length > 0) setActiveSessionId(parsed[0].id);
      } catch (e) { console.error("Failed to parse chats", e); }
    } else {
      createSession();
    }

    // Load AI settings
    const savedSettings = localStorage.getItem("trixty-ai-settings");
    if (savedSettings) {
      try {
        setAiSettings(JSON.parse(savedSettings));
      } catch (e) { console.error("Failed to parse AI settings", e); }
    } else {
      // Localize default if no settings saved
      import("@/api/trixty").then(({ trixty }) => {
        setAiSettings(prev => ({ ...prev, systemPrompt: trixty.l10n.t('ai.system_prompt') }));
      });
    }

    // Locale is now initialized directly in trixty.ts, but we sync local state here
    const savedLocale = localStorage.getItem("trixty-locale");
    if (savedLocale) {
      setLocaleState(savedLocale);
    }

    // Load Editor Settings
    const savedEditorSettings = localStorage.getItem("trixty-editor-settings");
    if (savedEditorSettings) {
      try {
        setEditorSettings(JSON.parse(savedEditorSettings));
      } catch (e) { console.error("Failed to parse editor settings", e); }
    }

    // Load System Settings
    const savedSystemSettings = localStorage.getItem("trixty-system-settings");
    if (savedSystemSettings) {
      try {
        setSystemSettings(JSON.parse(savedSystemSettings));
      } catch (e) { console.error("Failed to parse system settings", e); }
    }
  }, []);

  // Save chats on change
  useEffect(() => {
    if (chatSessions.length > 0) {
      localStorage.setItem("trixty-chats", JSON.stringify(chatSessions));
    }
  }, [chatSessions]);

  // Save settings on change
  useEffect(() => {
    localStorage.setItem("trixty-ai-settings", JSON.stringify(aiSettings));
  }, [aiSettings]);

  useEffect(() => {
    localStorage.setItem("trixty-editor-settings", JSON.stringify(editorSettings));
  }, [editorSettings]);

  useEffect(() => {
    localStorage.setItem("trixty-system-settings", JSON.stringify(systemSettings));
  }, [systemSettings]);

  const setLocale = useCallback((newLocale: string) => {
    import("@/api/trixty").then(({ trixty }) => {
      const oldSystemPrompt = trixty.l10n.t('ai.system_prompt');

      setLocaleState(newLocale);
      localStorage.setItem("trixty-locale", newLocale);
      trixty.l10n.setLocale(newLocale);

      // Update system prompt if it was the default one
      setAiSettings(prev => {
        if (prev.systemPrompt === oldSystemPrompt) {
          return { ...prev, systemPrompt: trixty.l10n.t('ai.system_prompt') };
        }
        return prev;
      });
    });
  }, [aiSettings.systemPrompt]);

  const updateAISettings = useCallback((newSettings: Partial<AISettings>) => {
    setAiSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

  const updateEditorSettings = useCallback((newSettings: Partial<EditorSettings>) => {
    setEditorSettings(prev => ({ ...prev, ...newSettings }));
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

  const getLanguageFromExtension = (filename: string) => {
    const ext = filename.split(".").pop()?.toLowerCase();
    const map: Record<string, string> = {
      // Web
      js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
      html: "html", htm: "html", css: "css", scss: "scss", less: "less",
      json: "json", jsonc: "json", webp: "image",

      // Systems & Backend
      rs: "rust", go: "go", py: "python", pyw: "python",
      c: "c", cpp: "cpp", h: "cpp", hpp: "cpp", cs: "csharp",
      java: "java", kt: "kotlin", rb: "ruby", php: "php",
      swift: "swift",

      // Configuration & Data
      toml: "toml", yaml: "yaml", yml: "yaml", xml: "xml",
      sql: "sql", prisma: "prisma", graphql: "graphql", gq: "graphql",
      env: "properties", ini: "ini",

      // Documentation & Tooling
      md: "markdown", mdx: "markdown", txt: "plaintext",
      dockerfile: "dockerfile", dockerignore: "dockerfile",
      gitignore: "ignore", sh: "shell", bash: "shell", zsh: "shell",
      ps1: "powershell", psd1: "powershell", psm1: "powershell",
      bat_cmd: "bat", svg: "html"
    };
    return map[ext!] || "plaintext";
  };

  const openFile = useCallback((path: string, name: string, content: string, type: "file" | "virtual" = "file") => {
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
  }, [getLanguageFromExtension]);

  const closeFile = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const filtered = prev.filter((f) => f.path !== path);
      if (currentFile?.path === path) {
        setCurrentFile(filtered.length > 0 ? filtered[filtered.length - 1] : null);
      }
      return filtered;
    });
  }, [currentFile]);

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



  const updateSystemSettings = useCallback((newSettings: Partial<SystemSettings>) => {
    setSystemSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

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
