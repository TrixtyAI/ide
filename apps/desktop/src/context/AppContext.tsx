"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { trixtyStore } from "@/api/store";
import { trixty as trixtyRef } from "@/api/trixty";
import { logger } from "@/lib/logger";
import { isTauri, safeInvoke } from "@/api/tauri";

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
  setRootPath: (path: string | null) => Promise<void>;
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
  /**
   * Streaming hook: update the last message in a session when it is an
   * assistant (`role: "ai"`) entry produced by the current stream. Used by
   * the AI-chat panel to progressively render tokens without remounting
   * the whole message list per delta. Callers typically push a placeholder
   * AI message first (with `addMessageToSession`) and then pass deltas
   * through here until the stream's `done` chunk arrives.
   */
  appendToLastAiMessage: (sessionId: string, delta: string) => void;
  /**
   * Finalizer counterpart to `appendToLastAiMessage`. Callers hand in the
   * authoritative `text` / `thinking` from the stream's `done` chunk; the
   * context mutates the last AI message in place. Both fields are optional
   * so a turn that only adds a thinking trace doesn't have to re-supply
   * the streamed text.
   */
  finalizeLastAiMessage: (sessionId: string, patch: { text?: string; thinking?: string }) => void;

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
  minimapEnabled: boolean;
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

// Schema versions for each persisted bundle. Bump when the shape of the
// stored data changes, then add a migration function at
// `getVersioned(..., { [prev]: (prev) => migrated })` in the load effect.
// A gap in the migration map is tolerated (additive changes with defaults);
// the ladder just passes the value through at that step. Downgrades (stored
// version > current) reset to defaults to avoid reading data we do not
// understand.
const CHATS_VERSION = 1;
const AI_SETTINGS_VERSION = 1;
const EDITOR_SETTINGS_VERSION = 1;
const SYSTEM_SETTINGS_VERSION = 1;
const LOCALE_VERSION = 1;

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
  minimapEnabled: false,
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

  // Use dynamic LanguageRegistry if available. Imported lazily to keep
  // Monaco off the boot graph — `@/api/trixty` constructs a Monaco
  // loader in its own module init, and this helper runs during the
  // first file-open, well after first paint.
  if (typeof window !== 'undefined') {
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
        logger.error("[AppContext] Failed to sync workspace root with Rust:", e);
        return;
      }
    }
    _setRootPath(path);
  }, []);
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
            logger.error("[AppContext] close-requested handler failed:", e);
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
    await trixtyStore.setVersioned("trixty-locale", newLocale, LOCALE_VERSION);
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
      logger.debug("[AppContext] Starting to load initial state from store...");
      try {
        // 1. Load AI Settings
        const savedSettings = await trixtyStore.getVersioned<AISettings | null>(
          "trixty-ai-settings",
          AI_SETTINGS_VERSION,
          null,
        );
        logger.debug("[AppContext] AI Settings loaded:", !!savedSettings);
        if (savedSettings) {
          setAiSettings(prev => ({ ...prev, ...savedSettings }));
        } else {
          // Fallback: translate the default system prompt if no settings found
          const { trixty } = await import("@/api/trixty");
          setAiSettings(prev => ({ ...prev, systemPrompt: trixty.l10n.t('ai.system_prompt') }));
        }

        // 2. Load Chats
        const savedChats = await trixtyStore.getVersioned<ChatSession[] | null>(
          "trixty-chats",
          CHATS_VERSION,
          null,
        );
        logger.debug("[AppContext] Chats loaded:", savedChats?.length || 0);
        if (savedChats && savedChats.length > 0) {
          setChatSessions(savedChats);
          setActiveSessionId(savedChats[0].id);
        } else {
          // Ensure at least one session exists
          createSession();
        }

        // 3. Load Locale
        const savedLocale = await trixtyStore.getVersioned<string | null>(
          "trixty-locale",
          LOCALE_VERSION,
          null,
        );
        logger.debug("[AppContext] Locale loaded:", savedLocale);
        if (savedLocale) {
          setLocale(savedLocale);
        } else {
          // Detect system language
          const detectedLocale = getSystemDefaultLocale();
          logger.debug("[AppContext] No saved locale found. Detected default:", detectedLocale);
          setLocale(detectedLocale);
        }
         // 4. Load Editor Settings
        const savedEditorSettings = await trixtyStore.getVersioned<EditorSettings | null>(
          "trixty-editor-settings",
          EDITOR_SETTINGS_VERSION,
          null,
        );
        logger.debug("[AppContext] Editor Settings loaded:", !!savedEditorSettings);
        if (savedEditorSettings) {
          setEditorSettings(prev => ({ ...prev, ...savedEditorSettings }));
        }

        // 5. Load System Settings
        const savedSystemSettings = await trixtyStore.getVersioned<SystemSettings | null>(
          "trixty-system-settings",
          SYSTEM_SETTINGS_VERSION,
          null,
        );
        logger.debug("[AppContext] System Settings loaded:", !!savedSystemSettings);
        if (savedSystemSettings) {
          setSystemSettings(prev => ({ ...prev, ...savedSystemSettings }));
        }

        // 6. If the user launched via `tide <path>` (or `TrixtyIDE --path
        // <path>`), Rust has already validated and canonicalised that
        // path. Take it out of managed state here — `take_initial_cli_workspace`
        // is a one-shot consumer, so a subsequent webview reload won't
        // re-apply a stale CLI value on top of a manually-picked folder.
        // We wire it through `setRootPath` (not the private setter) so the
        // Rust-side workspace-guard resync runs with the frontend's
        // canonical form.
        if (isTauri()) {
          try {
            const cliPath = await safeInvoke("take_initial_cli_workspace");
            if (cliPath) {
              logger.debug("[AppContext] Opening CLI-supplied workspace:", cliPath);
              await setRootPath(cliPath);
            }
          } catch (e) {
            // Non-fatal: the user can still open a folder manually.
            logger.warn("[AppContext] Failed to read CLI workspace path:", e);
          }
        }

        setIsInitialLoadComplete(true);
        logger.debug("[AppContext] Initial load complete.");
      } catch (err) {
        logger.error("[AppContext] Error loading initial state:", err);
        // Even on error, we should probably allow saving new changes
        setIsInitialLoadComplete(true);
      }
    };

    loadInitialState();
  }, [createSession, setLocale, getSystemDefaultLocale, setRootPath]);

  // Global: Remove default context menu
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  // Persistence effects — ONLY run after initial load to avoid overwriting the
  // store with defaults. Writes are debounced by 300 ms via effect cleanup:
  // the timer is scheduled on every state change and cancelled by the next
  // cleanup, so a burst of rapid edits (font-size slider, toggles) coalesces
  // into a single persisted write instead of firing once per keystroke.
  //
  // Trade-off: if the user closes the app within the 300 ms window, the last
  // change is lost. Acceptable for settings toggles; the next session reads a
  // value that is at most one debounce interval stale.
  const PERSIST_DEBOUNCE_MS = 300;

  useEffect(() => {
    if (!isInitialLoadComplete) return;
    if (chatSessions.length === 0) return;
    const handle = setTimeout(() => {
      trixtyStore.setVersioned("trixty-chats", chatSessions, CHATS_VERSION);
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [chatSessions, isInitialLoadComplete]);

  useEffect(() => {
    if (!isInitialLoadComplete) return;
    const handle = setTimeout(() => {
      trixtyStore.setVersioned("trixty-ai-settings", aiSettings, AI_SETTINGS_VERSION);
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [aiSettings, isInitialLoadComplete]);

  useEffect(() => {
    if (!isInitialLoadComplete) return;
    const handle = setTimeout(() => {
      trixtyStore.setVersioned("trixty-editor-settings", editorSettings, EDITOR_SETTINGS_VERSION);
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [editorSettings, isInitialLoadComplete]);

  useEffect(() => {
    if (!isInitialLoadComplete) return;
    const handle = setTimeout(() => {
      trixtyStore.setVersioned("trixty-system-settings", systemSettings, SYSTEM_SETTINGS_VERSION);
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(handle);
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

  // Progressive update for streamed assistant responses. Only mutates the
  // last message if it is an AI entry (placeholder already pushed by the
  // streaming caller). Ignored otherwise so a delta arriving after the chat
  // has moved on (session switch, new user message) cannot corrupt history.
  const appendToLastAiMessage = useCallback((sessionId: string, delta: string) => {
    if (!delta) return;
    setChatSessions(prev => prev.map(s => {
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

  // Called at the end of a streamed turn to attach metadata (thinking trace,
  // authoritative final text from the `done` chunk) to the placeholder
  // bubble the streaming path has been appending to. If the last entry is
  // not an AI message, or if the message has been replaced by the user in
  // the meantime, this is a no-op — matching `appendToLastAiMessage`'s
  // defensive semantics.
  const finalizeLastAiMessage = useCallback(
    (sessionId: string, patch: { text?: string; thinking?: string }) => {
      setChatSessions(prev => prev.map(s => {
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
    // Perform the path check inside the setter so debounced callers can't
    // overwrite a tab that happens to be active now but wasn't when the edit
    // was made. `updateFileContent` stays stable (no `currentFile` dep) so
    // consumers don't see it change when the active tab changes.
    setCurrentFile((prev) =>
      prev && prev.path === path ? { ...prev, content, isModified: true } : prev
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
          f.path === currentFile.path ? { ...f, isModified: false } : f
        )
      );
      setCurrentFile((prev) => (prev ? { ...prev, isModified: false } : null));
    } catch (error) {
      logger.error("Failed to save file:", error);
    }
  }, [currentFile]);

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
    await setRootPath(null);
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
  }, [getSystemDefaultLocale, setLocale, setRootPath]);

  // Memoize the context value so unrelated provider re-renders (for example
  // an `isSettingsOpen` toggle or an `aiSettings` update) don't ship a fresh
  // reference to every `useApp()` consumer. Writes that actually touch
  // `openFiles`/`currentFile` — e.g. a keystroke through `updateFileContent`
  // — still notify consumers; React context has no selector granularity, so
  // splitting the provider is the follow-up for that finer case.
  const value = useMemo(() => ({
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
    appendToLastAiMessage,
    finalizeLastAiMessage,
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
  }), [
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
    updateFileContent,
    saveCurrentFile,
    handleOpenFolder,
    openTerminal,
    terminalPath,
    chatSessions,
    activeSessionId,
    createSession,
    deleteSession,
    switchSession,
    addMessageToSession,
    appendToLastAiMessage,
    finalizeLastAiMessage,
    isSettingsOpen,
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
    setRootPath,
  ]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within an AppProvider");
  return context;
};
