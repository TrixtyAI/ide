"use client";

import { safeInvoke as invoke } from "@/api/tauri";
import { logger } from "@/lib/logger";

interface InlineCompletionRequest {
  /** Ollama base URL, e.g. `http://127.0.0.1:11434`. */
  endpoint: string;
  /** Model id (FIM-aware coder model, e.g. `qwen2.5-coder:7b`). */
  model: string;
  /** Everything before the cursor (already token-budgeted). */
  prefix: string;
  /** Everything after the cursor. May be empty. */
  suffix: string;
  /** Hard cap on tokens generated for the suggestion. */
  maxTokens: number;
  /** Aborts the in-flight request when the user keeps typing. */
  signal?: AbortSignal;
}

/**
 * Per-family FIM stop tokens. Each coder model family ends an
 * inline completion at different sentinels — Qwen and DeepSeek share
 * `<|fim_pad|>` / `<|file_separator|>`; StarCoder uses
 * `<file_sep>`/`<eos>`; CodeLlama uses `<EOT>` / `<MID>`. We pick the
 * matcher by a substring of the model id and fall back to a safe
 * baseline that just includes the universal `\n\n` plus generic
 * end-of-text sentinels — those never hurt even if the model emits
 * none of them.
 */
const STOP_TOKENS_BASE = ["\n\n", "<|endoftext|>"];
const STOP_TOKENS_BY_FAMILY: Array<{ match: RegExp; tokens: string[] }> = [
  {
    match: /qwen|deepseek/i,
    tokens: [
      ...STOP_TOKENS_BASE,
      "<|fim_pad|>",
      "<|file_separator|>",
      "<|endofline|>",
    ],
  },
  {
    match: /starcoder|santacoder/i,
    tokens: [...STOP_TOKENS_BASE, "<file_sep>", "<|endoftext|>", "<eos>"],
  },
  {
    match: /codellama/i,
    tokens: [...STOP_TOKENS_BASE, "<EOT>", "<MID>", "<PRE>", "<SUF>"],
  },
];

function stopTokensFor(modelId: string): string[] {
  const match = STOP_TOKENS_BY_FAMILY.find((f) => f.match.test(modelId));
  return match?.tokens ?? STOP_TOKENS_BASE;
}

/**
 * Single non-streaming Ollama `/api/generate` call with FIM (`prompt` +
 * `suffix`). Returns the raw completion text — caller decides whether to
 * surface it in Monaco's inline-completions provider.
 *
 * Errors are caught and converted to `null` so the caller can no-op
 * instead of throwing inside Monaco's render path.
 */
export async function requestInlineCompletion(
  req: InlineCompletionRequest,
): Promise<string | null> {
  if (req.signal?.aborted) return null;
  const sanitizedUrl = `${req.endpoint.replace(/\/+$/, "")}/api/generate`;

  try {
    // No streaming — Monaco wants the suggestion in one shot. `silent: true`
    // keeps `[Tauri Invoke Error]` out of the dev console for the common
    // case where Ollama is offline.
    const result = await invoke(
      "ollama_proxy",
      {
        method: "POST",
        url: sanitizedUrl,
        body: {
          type: "generate",
          model: req.model,
          prompt: req.prefix,
          suffix: req.suffix || undefined,
          stream: false,
          stop: stopTokensFor(req.model),
          options: {
            temperature: 0.2,
            top_p: 0.95,
            num_predict: req.maxTokens,
          },
        },
      },
      { silent: true },
    );

    if (req.signal?.aborted) return null;
    if (result.status < 200 || result.status >= 300) return null;

    const parsed = JSON.parse(result.body) as { response?: string };
    const response = parsed.response;
    if (typeof response !== "string" || response.length === 0) return null;
    return response;
  } catch (err) {
    if (req.signal?.aborted) return null;
    logger.debug("[aiCompletions] request failed:", err);
    return null;
  }
}
