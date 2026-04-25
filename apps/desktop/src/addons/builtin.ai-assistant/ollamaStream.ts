// Streaming-mode Ollama client for the AI chat panel.
//
// The Tauri backend pushes line-delimited JSON chunks from the Ollama
// `/api/chat` stream through a typed `ollama-stream` event (see
// `ollama_proxy_stream` in `src-tauri/src/lib.rs`). The frontend subscribes,
// filters by `streamId`, and threads `delta` content into the UI while the
// final `done` chunk carries the full message (including `tool_calls`).
//
// The NDJSON buffering logic is extracted as a pure function so it can be
// unit tested without stubbing the Tauri event bus.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { isTauri, type OllamaRequest } from "@/api/tauri";
import { logger } from "@/lib/logger";

/**
 * Event payload emitted by the Rust side on `ollama-stream`. Fields are
 * camelCase because the Rust struct uses `#[serde(rename_all = "camelCase")]`.
 */
export interface OllamaStreamEvent {
  streamId: string;
  kind: "delta" | "done" | "error";
  content?: string;
  message?: OllamaStreamFinalMessage;
  error?: string;
}

export interface OllamaStreamFinalMessage {
  role: "assistant";
  content: string;
  tool_calls?: {
    function: { name: string; arguments: Record<string, string | number | boolean | string[]> };
    id?: string;
    type?: string;
  }[];
  thinking?: string;
}

/**
 * One parsed NDJSON line. Anything we could not read as JSON is returned as
 * `kind: "error"` with the raw text so callers can log-and-skip rather than
 * blowing up the whole stream.
 */
export type ParsedLine =
  | { kind: "json"; value: unknown }
  | { kind: "error"; raw: string; error: string };

/**
 * Pure NDJSON buffer consumer.
 *
 * `reqwest::Response::bytes_stream` hands the frontend arbitrary byte slices:
 * a single chunk may carry zero, one, or several newline-delimited JSON lines,
 * and a line can be split across two chunks. Callers accumulate a `buffer`
 * across invocations and pass each new `chunk` here; the returned `remainder`
 * is whatever partial line the next chunk will need to prepend.
 *
 * A line that is not valid JSON does NOT abort the stream — we surface it as
 * `{ kind: "error" }` so the caller can `logger.warn(...)` and move on. The
 * Ollama server only writes one JSON object per line so a parse error is a
 * genuine anomaly (truncated chunk, proxy garbling), not a normal condition.
 */
export function parseStreamChunk(
  buffer: string,
  chunk: string,
): { lines: ParsedLine[]; remainder: string } {
  const combined = buffer + chunk;
  // Keep the search robust against `\r\n` — the Windows Ollama server has
  // been observed emitting CRLF occasionally. We split on LF and then trim
  // trailing CR from each line.
  const pieces = combined.split("\n");
  // The final element is either empty (the combined text ended on a newline)
  // or a partial line that has not yet been terminated. Either way it gets
  // carried forward as the remainder.
  const remainder = pieces.pop() ?? "";
  const lines: ParsedLine[] = [];
  for (const piece of pieces) {
    const trimmed = piece.endsWith("\r") ? piece.slice(0, -1) : piece;
    if (trimmed.length === 0) continue;
    try {
      lines.push({ kind: "json", value: JSON.parse(trimmed) });
    } catch (err) {
      lines.push({
        kind: "error",
        raw: trimmed,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { lines, remainder };
}

/**
 * Streams an Ollama `/api/chat` response via the Rust side-channel, calling
 * `onDelta(content)` for each partial token and returning the full `done`
 * message when the stream completes.
 *
 * Abort semantics: listening for `abortSignal.abort()` fires
 * `ollama_proxy_cancel` on the backend so the tokio task tears down before
 * any more chunks arrive. An aborted stream resolves with an `AbortError`
 * so the caller's existing AbortError branch still fires.
 */
export async function streamOllamaChat(
  url: string,
  body: OllamaRequest,
  onDelta: (content: string) => void,
  abortSignal: AbortSignal,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; status: number; message?: OllamaStreamFinalMessage; errorText?: string }> {
  if (!isTauri()) {
    throw new Error("streamOllamaChat requires the Tauri runtime");
  }
  // Prefer the native crypto.randomUUID when available; fall back to a
  // sufficiently unique alternative for jsdom / older runtimes.
  const streamId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `stream-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  let unlisten: UnlistenFn | undefined;
  let finalMessage: OllamaStreamFinalMessage | undefined;
  let errorText: string | undefined;
  let status = 200;

  const settled = new Promise<void>((resolve, reject) => {
    listen<OllamaStreamEvent>("ollama-stream", (event) => {
      const payload = event.payload;
      if (payload.streamId !== streamId) return;
      if (payload.kind === "delta") {
        if (payload.content) onDelta(payload.content);
        return;
      }
      if (payload.kind === "done") {
        finalMessage = payload.message;
        resolve();
        return;
      }
      if (payload.kind === "error") {
        errorText = payload.error ?? "Unknown streaming error";
        // Heuristic: preserve a 400-ish signal so the deep-think fallback
        // can branch on it the same way the one-shot proxy does.
        if (/\b400\b/.test(errorText) || /think/i.test(errorText)) {
          status = 400;
        } else {
          status = 500;
        }
        reject(new Error(errorText));
      }
    }).then((u) => {
      unlisten = u;
    });
  });

  const onAbort = () => {
    tauriInvoke("ollama_proxy_cancel", { streamId }).catch((err) => {
      logger.warn("[ollamaStream] cancel failed:", err);
    });
  };
  if (abortSignal.aborted) {
    onAbort();
  } else {
    abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    await tauriInvoke("ollama_proxy_stream", {
      streamId,
      method: "POST",
      url,
      headers,
      body,
    });
    await settled;
    return {
      ok: true,
      status: 200,
      message: finalMessage,
    };
  } catch (err) {
    if (abortSignal.aborted) {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      throw abortError;
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status,
      errorText: errorText ?? message,
    };
  } finally {
    if (unlisten) unlisten();
    abortSignal.removeEventListener("abort", onAbort);
  }
}
