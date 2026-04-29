"use client";

import type { ProviderId } from "@/context/SettingsContext";

export interface ProviderMeta {
  id: ProviderId;
  /** Human-friendly label shown in chat header / settings. */
  label: string;
  /** "Cloud" providers require an API key + the Rust cloud_proxy. Ollama is
   *  the local exception and routes through `ollama_proxy` instead. */
  kind: "local" | "cloud";
  /** Optional placeholder model name (used to suggest the input format
   *  in the Settings → Provider Keys add-model field). */
  placeholderModel: string;
  /** External provider docs the user is sent to from the Settings page. */
  docsUrl: string;
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  ollama: {
    id: "ollama",
    label: "Ollama (Local)",
    kind: "local",
    placeholderModel: "qwen2.5-coder:7b",
    docsUrl: "https://ollama.com",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    kind: "cloud",
    placeholderModel: "gpt-4o-mini",
    docsUrl: "https://platform.openai.com/docs/models",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    kind: "cloud",
    placeholderModel: "claude-3-5-sonnet-latest",
    docsUrl: "https://docs.anthropic.com/en/docs/about-claude/models",
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    kind: "cloud",
    placeholderModel: "gemini-2.0-flash",
    docsUrl: "https://ai.google.dev/gemini-api/docs/models",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    kind: "cloud",
    placeholderModel: "deepseek/deepseek-chat",
    docsUrl: "https://openrouter.ai/models",
  },
};

export const PROVIDER_IDS: ProviderId[] = [
  "ollama",
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
];
