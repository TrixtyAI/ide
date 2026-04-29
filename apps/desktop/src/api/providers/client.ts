"use client";

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { safeInvoke as invoke } from "@/api/tauri";
import type { ProviderId } from "@/context/SettingsContext";
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

interface ProviderRequest {
  url: string;
  headers: Array<[string, string]>;
  body: unknown;
}

/**
 * Build the URL / headers / body for a provider chat call. The `stream`
 * flag toggles the streaming endpoint (Gemini changes URL; the others
 * just set `stream: true` in the body) so the same builder backs both
 * `cloudChat` and `streamCloudChat`.
 */
function buildProviderRequest(
  req: CloudChatRequest,
  stream: boolean,
): ProviderRequest {
  switch (req.provider) {
    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: [
          ["Authorization", `Bearer ${req.apiKey}`],
          ["Content-Type", "application/json"],
        ],
        body: {
          model: req.model,
          messages: req.messages,
          temperature: req.temperature ?? 0.7,
          max_tokens: req.maxTokens ?? 2048,
          stream,
        },
      };
    case "openrouter":
      return {
        url: "https://openrouter.ai/api/v1/chat/completions",
        headers: [
          ["Authorization", `Bearer ${req.apiKey}`],
          ["Content-Type", "application/json"],
          ["HTTP-Referer", "https://github.com/TrixtyAI/ide"],
          ["X-Title", "Trixty IDE"],
        ],
        body: {
          model: req.model,
          messages: req.messages,
          temperature: req.temperature ?? 0.7,
          max_tokens: req.maxTokens ?? 2048,
          stream,
        },
      };
    case "anthropic": {
      // Anthropic separates the system prompt from the messages array.
      const systemMessages = req.messages.filter((m) => m.role === "system");
      const conversation = req.messages.filter((m) => m.role !== "system");
      const system = systemMessages
        .map((m) => m.content)
        .join("\n\n")
        .trim();
      return {
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
          stream,
        },
      };
    }
    case "gemini": {
      // Gemini supports the API key either as a query param or the
      // `x-goog-api-key` header. We use the header form so the key never
      // shows up in URL logs (Tauri's `e.to_string()` on a transport
      // failure echoes the URL, OS-level proxies log query strings, etc.).
      const path = stream ? "streamGenerateContent?alt=sse" : "generateContent";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        req.model,
      )}:${path}`;
      const systemMessages = req.messages.filter((m) => m.role === "system");
      const conversation = req.messages.filter((m) => m.role !== "system");
      const systemInstruction = systemMessages.length
        ? {
            role: "user",
            parts: [
              { text: systemMessages.map((m) => m.content).join("\n\n") },
            ],
          }
        : undefined;
      return {
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
      };
    }
  }
}

function validateRequest(req: CloudChatRequest): CloudChatResult | null {
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
  return null;
}

/**
 * Single-shot non-streaming chat for cloud providers. Kept for callers
 * that need the full reply atomically (e.g. background tool-summary
 * jobs). For interactive chat use `streamCloudChat`, which threads
 * tokens into the UI as they arrive.
 */
export async function cloudChat(req: CloudChatRequest): Promise<CloudChatResult> {
  const invalid = validateRequest(req);
  if (invalid) return invalid;

  try {
    const config = buildProviderRequest(req, false);
    const result = await invoke(
      "cloud_proxy",
      {
        method: "POST",
        url: config.url,
        headers: config.headers,
        body: config.body,
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
    const text = extractFullResponse(req.provider, result.body);
    return { ok: text.length > 0, text };
  } catch (err) {
    if (req.signal?.aborted) return { ok: false, text: "", error: "aborted" };
    logger.warn(`[providers/${req.provider}] chat failed:`, err);
    return { ok: false, text: "", error: String(err) };
  }
}

/**
 * Streaming chat for cloud providers. Emits each token to `onDelta` as
 * it arrives and resolves with the full concatenated text on completion.
 * The Rust `cloud_proxy_stream` command pumps SSE events back through
 * the `cloud-stream` Tauri event keyed by a UUID `streamId`.
 *
 * Cancellation: if `req.signal` aborts mid-stream the helper fires
 * `cloud_proxy_cancel` so the tokio task tears down before more chunks
 * arrive, then re-throws an `AbortError` so callers can branch the same
 * way they do for `streamOllamaChat`.
 */
export async function streamCloudChat(
  req: CloudChatRequest,
  onDelta: (text: string) => void,
): Promise<CloudChatResult> {
  const invalid = validateRequest(req);
  if (invalid) return invalid;

  const config = buildProviderRequest(req, true);
  const streamId = crypto.randomUUID();

  let fullText = "";
  let errorText: string | undefined;
  let unlisten: UnlistenFn | undefined;
  let aborted = false;

  const settled = new Promise<void>((resolve, reject) => {
    listen<CloudStreamEvent>("cloud-stream", (event) => {
      const payload = event.payload;
      if (payload.streamId !== streamId) return;
      if (payload.kind === "data") {
        const delta = extractStreamDelta(req.provider, payload.data ?? "");
        if (delta) {
          fullText += delta;
          onDelta(delta);
        }
        return;
      }
      if (payload.kind === "done") {
        resolve();
        return;
      }
      if (payload.kind === "error") {
        errorText = payload.error ?? "Unknown streaming error";
        reject(new Error(errorText));
      }
    }).then((u) => {
      unlisten = u;
    });
  });

  const onAbort = () => {
    aborted = true;
    tauriInvoke("cloud_proxy_cancel", { streamId }).catch((err) => {
      logger.debug("[providers/cloud] cancel failed:", err);
    });
  };
  if (req.signal?.aborted) {
    onAbort();
  } else if (req.signal) {
    req.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    await tauriInvoke("cloud_proxy_stream", {
      streamId,
      method: "POST",
      url: config.url,
      headers: config.headers,
      body: config.body,
    });
    await settled;
    return { ok: fullText.length > 0, text: fullText };
  } catch (err) {
    if (aborted) {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      throw abortError;
    }
    return {
      ok: false,
      text: fullText,
      error: errorText ?? (err instanceof Error ? err.message : String(err)),
    };
  } finally {
    if (unlisten) unlisten();
    if (req.signal) req.signal.removeEventListener("abort", onAbort);
  }
}

interface CloudStreamEvent {
  streamId: string;
  kind: "data" | "done" | "error";
  data?: string;
  error?: string;
}

/**
 * Per-provider parse of one SSE `data:` payload into the delta text to
 * append. Returns `""` for keep-alive / housekeeping events (Anthropic
 * `ping`, message_start / stop, etc.) so the caller can ignore them.
 */
export function extractStreamDelta(
  provider: Exclude<ProviderId, "ollama">,
  raw: string,
): string {
  if (!raw || raw === "[DONE]") return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "";
  }
  if (typeof parsed !== "object" || parsed === null) return "";
  const obj = parsed as Record<string, unknown>;

  switch (provider) {
    case "openai":
    case "openrouter": {
      const choices = obj.choices as
        | Array<{ delta?: { content?: string } }>
        | undefined;
      return choices?.[0]?.delta?.content ?? "";
    }
    case "anthropic": {
      if (obj.type !== "content_block_delta") return "";
      const delta = obj.delta as
        | { type?: string; text?: string }
        | undefined;
      if (delta?.type !== "text_delta") return "";
      return delta.text ?? "";
    }
    case "gemini": {
      const candidates = obj.candidates as
        | Array<{ content?: { parts?: Array<{ text?: string }> } }>
        | undefined;
      return (
        candidates
          ?.flatMap((c) => c.content?.parts ?? [])
          .map((p) => p.text ?? "")
          .join("") ?? ""
      );
    }
  }
}

/**
 * Per-provider parse of a non-streaming JSON body. Mirror of
 * `extractStreamDelta`'s switch but for the full-response shape. Kept
 * exported so unit tests can hit each branch without the proxy bridge.
 */
export function extractFullResponse(
  provider: Exclude<ProviderId, "ollama">,
  body: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return "";
  }
  if (typeof parsed !== "object" || parsed === null) return "";
  const obj = parsed as Record<string, unknown>;

  switch (provider) {
    case "openai":
    case "openrouter": {
      const choices = obj.choices as
        | Array<{ message?: { content?: string } }>
        | undefined;
      return choices?.[0]?.message?.content ?? "";
    }
    case "anthropic": {
      const content = obj.content as
        | Array<{ type: string; text?: string }>
        | undefined;
      return (
        content
          ?.filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("") ?? ""
      );
    }
    case "gemini": {
      const candidates = obj.candidates as
        | Array<{ content?: { parts?: Array<{ text?: string }> } }>
        | undefined;
      return (
        candidates
          ?.flatMap((c) => c.content?.parts ?? [])
          .map((p) => p.text ?? "")
          .join("") ?? ""
      );
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
