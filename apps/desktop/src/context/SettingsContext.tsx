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

export interface InlineCompletionSettings {
  /** Off by default — opt-in because every keystroke can hit Ollama. */
  enabled: boolean;
  /** Optional override; falls back to the chat-selected model when empty. */
  model: string;
  /** Wait ms after last keystroke before requesting a suggestion. */
  debounceMs: number;
  /** Cap suggestion length so the request doesn't run for seconds. */
  maxTokens: number;
}

/**
 * Provider IDs registered in `src/api/providers/registry.ts`. The literal
 * union here is duplicated on purpose so consumers that only import
 * SettingsContext don't pull the provider registry chunk.
 */
export type ProviderId =
  | "ollama"
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter";

export interface ProviderKeys {
  openai: string;
  anthropic: string;
  gemini: string;
  openrouter: string;
}

export type ProviderModelMap = Record<ProviderId, string[]>;
export type ProviderLastModelMap = Partial<Record<ProviderId, string>>;

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
  inlineCompletions: InlineCompletionSettings;
  /** Master switch — when off, the chat header hides cloud-provider UI
   *  and stays Ollama-only. Mirrors VSCode's "AI Cloud" gating. */
  allowProviderKeys: boolean;
  /** Plaintext API keys for cloud providers. Persisted in tauri-store
   *  (`settings.json`) — same trust boundary as everything else in the
   *  app data dir. Encryption via OS keychain is a follow-up. */
  providerKeys: ProviderKeys;
  /** User-curated model list per provider. We don't auto-fetch model
   *  catalogues for cloud APIs because the inventories shift weekly and
   *  most tiers gate them behind separate billing. The user adds the
   *  exact model strings they want to use, mirroring the File-Exclusion
   *  pattern that the issue calls out. */
  providerModels: ProviderModelMap;
  /** ID of the provider currently driving chat. Defaults to Ollama so
   *  existing users see no behavioural change after an upgrade. */
  activeProvider: ProviderId;
  /** Last selected model per provider so switching providers restores
   *  the user's previous pick instead of resetting to the first entry. */
  lastModelByProvider: ProviderLastModelMap;
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
const AI_SETTINGS_VERSION = 3;
const EDITOR_SETTINGS_VERSION = 1;
const SYSTEM_SETTINGS_VERSION = 2;
const LOCALE_VERSION = 1;

export const DEFAULT_INLINE_COMPLETIONS: InlineCompletionSettings = {
  enabled: false,
  model: "",
  debounceMs: 250,
  maxTokens: 64,
};

export const DEFAULT_PROVIDER_KEYS: ProviderKeys = {
  openai: "",
  anthropic: "",
  gemini: "",
  openrouter: "",
};

// Curated default model lists — visible to the user as soon as they
// enable a provider so they don't have to type IDs from memory. Each
// list mixes flagship + cost-efficient + reasoning + coding-tuned
// options. Users can add or remove entries from Settings → Provider
// Keys → Add models. IDs reflect each provider's catalogue as of
// April 2026 (verified via the providers' own docs); check each
// provider's docs for newer entries.
//
// ⚠️ GPT-5.5 (`gpt-5.5-2026-04-23`) is intentionally NOT listed: it is
// only reachable through ChatGPT auth, not the API-key flow this app
// uses. Users who want it can add it manually if their access changes.
export const DEFAULT_PROVIDER_MODELS: ProviderModelMap = {
  ollama: [],
  openai: [
    // GPT-5.x family (Codex variants are agentic-coding tuned)
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3",
    "gpt-5.3-codex",
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5",
    "gpt-5-codex",
    "gpt-5-mini",
    "gpt-5-nano",
    // GPT-4.1 family
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    // GPT-4o family
    "gpt-4o",
    "gpt-4o-mini",
    "chatgpt-4o-latest",
    // Reasoning (o-series)
    "o1",
    "o1-mini",
    "o3",
    "o3-mini",
    "o4-mini",
  ],
  anthropic: [
    // Claude 4.x family (current)
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-6",
    "claude-opus-4-1-20250805",
    "claude-sonnet-4-5-20250929",
    "claude-sonnet-4-20250514",
    // Claude 3.x (legacy but still served)
    "claude-3-7-sonnet-latest",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest",
  ],
  gemini: [
    // Gemini 3.x family (current flagships)
    "gemini-3.1-pro-preview",
    "gemini-3-flash",
    "gemini-3.1-flash",
    // Gemini 2.5 family
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    // Gemini 2.0 family (sunset June 2026 — kept while still served)
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash-thinking-exp",
    // Gemini 1.5 family (legacy)
    "gemini-1.5-pro-latest",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash-8b-latest",
  ],
  openrouter: [
    // Anthropic via OpenRouter
    "anthropic/claude-opus-4.7",
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-haiku-4.5",
    "anthropic/claude-3.7-sonnet",
    "anthropic/claude-3.5-sonnet",
    "anthropic/claude-3.5-haiku",
    // OpenAI via OpenRouter
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "openai/gpt-5",
    "openai/gpt-5-codex",
    "openai/gpt-4.1",
    "openai/gpt-4o",
    "openai/o3",
    "openai/o3-mini",
    // Google via OpenRouter
    "google/gemini-3.1-pro",
    "google/gemini-3-flash",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash",
    // DeepSeek
    "deepseek/deepseek-v4-pro",
    "deepseek/deepseek-v4-flash",
    "deepseek/deepseek-v3.2",
    "deepseek/deepseek-chat",
    "deepseek/deepseek-r1",
    // xAI Grok
    "x-ai/grok-4.3",
    "x-ai/grok-4.1-fast",
    // Meta / Qwen / Mistral
    "meta-llama/llama-3.3-70b-instruct",
    "qwen/qwen-2.5-coder-32b-instruct",
    "mistralai/mistral-large-latest",
  ],
};

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
  inlineCompletions: DEFAULT_INLINE_COMPLETIONS,
  allowProviderKeys: false,
  providerKeys: DEFAULT_PROVIDER_KEYS,
  providerModels: DEFAULT_PROVIDER_MODELS,
  activeProvider: "ollama",
  lastModelByProvider: {},
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
          {
            // v1 → v2: add `inlineCompletions` block (issue #258).
            // Existing v1 payloads stay intact, the new block lands with
            // `enabled: false` so users opt in.
            1: (prev) => ({
              ...(prev as AISettings),
              inlineCompletions: { ...DEFAULT_INLINE_COMPLETIONS },
            }),
            // v2 → v3: add multi-provider keys / models / active provider
            // (issue #267). Existing v2 payloads stay Ollama-only with
            // `allowProviderKeys: false`, so users see no behaviour change
            // until they explicitly opt in under Settings → Configuration.
            2: (prev) => ({
              ...(prev as AISettings),
              allowProviderKeys: false,
              providerKeys: { ...DEFAULT_PROVIDER_KEYS },
              providerModels: { ...DEFAULT_PROVIDER_MODELS },
              activeProvider: "ollama",
              lastModelByProvider: {},
            }),
          },
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

  // One-shot lazy migration: any provider key still living in
  // `aiSettings.providerKeys` (the pre-keychain plaintext field) gets
  // moved to the OS keychain on the first load that detects it, then
  // the settings field is cleared so the next persist doesn't write
  // the secret back to disk. Idempotent — once `providerKeys` is empty
  // this effect short-circuits on every subsequent boot.
  useEffect(() => {
    if (!isInitialLoadComplete) return;
    const entries = Object.entries(aiSettings.providerKeys ?? {}).filter(
      ([, v]) => typeof v === "string" && v.length > 0,
    ) as Array<[keyof ProviderKeys, string]>;
    if (entries.length === 0) return;
    let cancelled = false;
    (async () => {
      const { setProviderSecret } = await import("@/api/providerSecrets");
      for (const [provider, secret] of entries) {
        try {
          await setProviderSecret(
            provider as "openai" | "anthropic" | "gemini" | "openrouter",
            secret,
          );
        } catch (err) {
          logger.warn(
            `[SettingsContext] keychain migration failed for ${provider}:`,
            err,
          );
          // Bail out without clearing — the next boot will retry. Better
          // to leave the plaintext in place than lose the key entirely.
          return;
        }
      }
      if (cancelled) return;
      setAiSettings((prev) => ({
        ...prev,
        providerKeys: { ...DEFAULT_PROVIDER_KEYS },
      }));
      logger.debug(
        `[SettingsContext] migrated ${entries.length} provider key(s) from settings.json to OS keychain.`,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [isInitialLoadComplete, aiSettings.providerKeys]);

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
