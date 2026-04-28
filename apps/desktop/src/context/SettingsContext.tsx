"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import { trixtyStore } from "@/api/store";
import { logger } from "@/lib/logger";

export type UpdateChannel = "stable" | "pre-release";

export interface SystemSettings {
  hasCompletedOnboarding: boolean;
  filesExclude: string[];
  updateChannel: UpdateChannel;
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

interface SettingsContextType {
  aiSettings: AISettings;
  editorSettings: EditorSettings;
  systemSettings: SystemSettings;
  locale: string;
  isInitialLoadComplete: boolean;
  updateAISettings: (settings: Partial<AISettings>) => void;
  updateEditorSettings: (settings: Partial<EditorSettings>) => void;
  updateSystemSettings: (settings: Partial<SystemSettings>) => void;
  setLocale: (locale: string) => Promise<void>;
  /** Reset hook used by `useResetApp`. */
  resetSettings: (detectedLocale: string) => Promise<void>;
  /** Toggle used by `useResetApp` to gate persistence while resetting. */
  setInitialLoadComplete: (value: boolean) => void;
}

// Schema versions for each persisted bundle. Bump when the shape of the
// stored data changes, then add a migration function at
// `getVersioned(..., { [prev]: (prev) => migrated })` in the load effect.
const AI_SETTINGS_VERSION = 1;
const EDITOR_SETTINGS_VERSION = 1;
const SYSTEM_SETTINGS_VERSION = 2;
const LOCALE_VERSION = 1;

export const DEFAULT_AI_SETTINGS: AISettings = {
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

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 14,
  fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
  theme: "trixty-dark",
  lineHeight: 21,
  minimapEnabled: false,
};

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  hasCompletedOnboarding: false,
  filesExclude: [
    "**/.git",
    "**/.svn",
    "**/.hg",
    "**/.DS_Store",
    "**/Thumbs.db",
    "**/.classpath",
    "**/.factorypath",
    "**/.project",
    "**/.settings",
    "**/node_modules",
    "**/yarn.lock",
  ],
  updateChannel: "stable",
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [aiSettings, setAiSettings] = useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(DEFAULT_SYSTEM_SETTINGS);
  const [locale, setLocaleState] = useState("en");
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);

  const setLocale = useCallback(async (newLocale: string) => {
    const { trixty } = await import("@/api/trixty");
    const oldSystemPrompt = trixty.l10n.t("ai.system_prompt");

    setLocaleState(newLocale);
    await trixtyStore.setVersioned("trixty-locale", newLocale, LOCALE_VERSION);
    trixty.l10n.setLocale(newLocale);

    // Update system prompt if it was the default one
    setAiSettings((prev) => {
      if (prev.systemPrompt === oldSystemPrompt) {
        return { ...prev, systemPrompt: trixty.l10n.t("ai.system_prompt") };
      }
      return prev;
    });
  }, []);

  // Load settings on mount.
  useEffect(() => {
    const loadInitialState = async () => {
      logger.debug("[SettingsContext] Loading initial state from store...");
      try {
        const savedSettings = await trixtyStore.getVersioned<AISettings | null>(
          "trixty-ai-settings",
          AI_SETTINGS_VERSION,
          null,
        );
        if (savedSettings) {
          setAiSettings((prev) => ({ ...prev, ...savedSettings }));
        } else {
          const { trixty } = await import("@/api/trixty");
          setAiSettings((prev) => ({ ...prev, systemPrompt: trixty.l10n.t("ai.system_prompt") }));
        }

        const savedLocale = await trixtyStore.getVersioned<string | null>(
          "trixty-locale",
          LOCALE_VERSION,
          null,
        );
        if (savedLocale) {
          await setLocale(savedLocale);
        } else {
          await setLocale("en");
        }

        const savedEditorSettings = await trixtyStore.getVersioned<EditorSettings | null>(
          "trixty-editor-settings",
          EDITOR_SETTINGS_VERSION,
          null,
        );
        if (savedEditorSettings) {
          setEditorSettings((prev) => ({ ...prev, ...savedEditorSettings }));
        }

        const savedSystemSettings = await trixtyStore.getVersioned<SystemSettings | null>(
          "trixty-system-settings",
          SYSTEM_SETTINGS_VERSION,
          null,
        );
        if (savedSystemSettings) {
          setSystemSettings((prev) => ({ ...prev, ...savedSystemSettings }));
        }

        setIsInitialLoadComplete(true);
        logger.debug("[SettingsContext] Initial load complete.");
      } catch (err) {
        logger.error("[SettingsContext] Error loading initial state:", err);
        // Even on error, allow saving new changes.
        setIsInitialLoadComplete(true);
      }
    };

    loadInitialState();
  }, [setLocale]);

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
    setAiSettings((prev) => ({ ...prev, ...newSettings }));
  }, []);

  const updateEditorSettings = useCallback((newSettings: Partial<EditorSettings>) => {
    setEditorSettings((prev) => ({ ...prev, ...newSettings }));
  }, []);

  const updateSystemSettings = useCallback((newSettings: Partial<SystemSettings>) => {
    setSystemSettings((prev) => ({ ...prev, ...newSettings }));
  }, []);

  const resetSettings = useCallback(async (detectedLocale: string) => {
    setAiSettings(DEFAULT_AI_SETTINGS);
    setEditorSettings(DEFAULT_EDITOR_SETTINGS);
    setSystemSettings(DEFAULT_SYSTEM_SETTINGS);
    await setLocale(detectedLocale);
  }, [setLocale]);

  const setInitialLoadComplete = useCallback((value: boolean) => {
    setIsInitialLoadComplete(value);
  }, []);

  const value = useMemo(() => ({
    aiSettings,
    editorSettings,
    systemSettings,
    locale,
    isInitialLoadComplete,
    updateAISettings,
    updateEditorSettings,
    updateSystemSettings,
    setLocale,
    resetSettings,
    setInitialLoadComplete,
  }), [
    aiSettings,
    editorSettings,
    systemSettings,
    locale,
    isInitialLoadComplete,
    updateAISettings,
    updateEditorSettings,
    updateSystemSettings,
    setLocale,
    resetSettings,
    setInitialLoadComplete,
  ]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used within a SettingsProvider");
  return context;
};
