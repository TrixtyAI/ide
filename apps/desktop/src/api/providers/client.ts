"use client";

import { safeInvoke as invoke } from "@/api/tauri";
import type { ProviderId, ProviderKeys } from "@/context/SettingsContext";
import { logger } from "@/lib/logger";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CloudChatRequest {
  provider: Exclude<ProviderId, "ollama">;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CloudChatResult {
  ok: boolean;
  text: string;
  error?: string;
}

/**
 * Single-shot non-streaming chat for cloud providers. Streaming for
 * cloud is a follow-up — every provider here uses a different SSE
 * envelope and the Rust side currently only has a streaming bridge for
 * Ollama. Returning the whole reply once the request resolves lets us
 * wire all four providers without a per-provider streaming bridge.
 */
export async function cloudChat(req: CloudChatRequest): Promise<CloudChatResult> {
  if (req.signal?.aborted) return { ok: false, text: "", error: "aborted" };
  if (!req.apiKey) {
    return {
      ok: false,
      text: "",
      error: `Missing API key for ${req.provider}`,
    };
  }
  if (!req.model) {
    return {
      ok: false,
      text: "",
      error: `No model selected for ${req.provider}`,
    };
  }

  try {
    switch (req.provider) {
      case "openai":
        return await chatOpenAICompatible(
          "https://api.openai.com/v1/chat/completions",
          req,
        );
      case "openrouter":
        return await chatOpenAICompatible(
          "https://openrouter.ai/api/v1/chat/completions",
          req,
        );
      case "anthropic":
        return await chatAnthropic(req);
      case "gemini":
        return await chatGemini(req);
    }
  } catch (err) {
    if (req.signal?.aborted) return { ok: false, text: "", error: "aborted" };
    logger.warn(`[providers/${req.provider}] chat failed:`, err);
    return { ok: false, text: "", error: String(err) };
  }
}

/**
 * OpenAI / OpenRouter share the `/v1/chat/completions` shape. OpenRouter
 * also requires the standard `Authorization: Bearer KEY` header — the
 * `HTTP-Referer` and `X-Title` headers are optional metadata that
 * surface the app name in OpenRouter's dashboards.
 */
async function chatOpenAICompatible(
  url: string,
  req: CloudChatRequest,
): Promise<CloudChatResult> {
  const headers: Array<[string, string]> = [
    ["Authorization", `Bearer ${req.apiKey}`],
    ["Content-Type", "application/json"],
  ];
  if (req.provider === "openrouter") {
    headers.push(["HTTP-Referer", "https://github.com/TrixtyAI/ide"]);
    headers.push(["X-Title", "Trixty IDE"]);
  }
  const result = await invoke(
    "cloud_proxy",
    {
      method: "POST",
      url,
      headers,
      body: {
        model: req.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 2048,
      },
    },
    { silent: true },
  );
  if (result.status < 200 || result.status >= 300) {
    return {
      ok: false,
      text: "",
      error: `${req.provider} HTTP ${result.status}: ${truncate(result.body, 240)}`,
    };
  }
  const parsed = JSON.parse(result.body) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = parsed.choices?.[0]?.message?.content ?? "";
  return { ok: text.length > 0, text };
}

async function chatAnthropic(req: CloudChatRequest): Promise<CloudChatResult> {
  // Anthropic separates the system prompt from the messages array. Pull
  // any leading system message into the dedicated `system` field.
  const systemMessages = req.messages.filter((m) => m.role === "system");
  const conversation = req.messages.filter((m) => m.role !== "system");
  const system = systemMessages.map((m) => m.content).join("\n\n").trim();
  const result = await invoke(
    "cloud_proxy",
    {
      method: "POST",
      url: "https://api.anthropic.com/v1/messages",
      headers: [
        ["x-api-key", req.apiKey],
        ["anthropic-version", "2023-06-01"],
        ["Content-Type", "application/json"],
      ],
      body: {
        model: req.model,
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.7,
        system: system || undefined,
        messages: conversation.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
      },
    },
    { silent: true },
  );
  if (result.status < 200 || result.status >= 300) {
    return {
      ok: false,
      text: "",
      error: `anthropic HTTP ${result.status}: ${truncate(result.body, 240)}`,
    };
  }
  const parsed = JSON.parse(result.body) as {
    content?: { type: string; text?: string }[];
  };
  const text = (parsed.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  return { ok: text.length > 0, text };
}

async function chatGemini(req: CloudChatRequest): Promise<CloudChatResult> {
  // Gemini supports the API key either as a query param or the
  // `x-goog-api-key` header. We use the header form so the key never
  // shows up in URL logs (Tauri's `e.to_string()` on a transport
  // failure echoes the URL, OS-level proxies log query strings, etc.).
  // Body uses Gemini's `contents` shape with `user` / `model` roles.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    req.model,
  )}:generateContent`;
  const systemMessages = req.messages.filter((m) => m.role === "system");
  const conversation = req.messages.filter((m) => m.role !== "system");
  const systemInstruction = systemMessages.length
    ? {
        role: "user",
        parts: [{ text: systemMessages.map((m) => m.content).join("\n\n") }],
      }
    : undefined;
  const result = await invoke(
    "cloud_proxy",
    {
      method: "POST",
      url,
      headers: [
        ["x-goog-api-key", req.apiKey],
        ["Content-Type", "application/json"],
      ],
      body: {
        contents: conversation.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        ...(systemInstruction ? { systemInstruction } : {}),
        generationConfig: {
          temperature: req.temperature ?? 0.7,
          maxOutputTokens: req.maxTokens ?? 2048,
        },
      },
    },
    { silent: true },
  );
  if (result.status < 200 || result.status >= 300) {
    return {
      ok: false,
      text: "",
      error: `gemini HTTP ${result.status}: ${truncate(result.body, 240)}`,
    };
  }
  const parsed = JSON.parse(result.body) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (parsed.candidates ?? [])
    .flatMap((c) => c.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
  return { ok: text.length > 0, text };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Resolve the right key for a cloud provider, returning `""` for Ollama. */
export function keyForProvider(
  keys: ProviderKeys,
  provider: ProviderId,
): string {
  switch (provider) {
    case "openai":
      return keys.openai;
    case "anthropic":
      return keys.anthropic;
    case "gemini":
      return keys.gemini;
    case "openrouter":
      return keys.openrouter;
    default:
      return "";
  }
}
