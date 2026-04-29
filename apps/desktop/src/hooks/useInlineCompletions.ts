"use client";

import { useEffect } from "react";
import type { Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditor, languages, Position, CancellationToken } from "monaco-editor";
import { requestInlineCompletion } from "@/api/aiCompletions";
import { useSettings } from "@/context/SettingsContext";
import { trixtyStore } from "@/api/store";
import { logger } from "@/lib/logger";

// Token budgets for the FIM context window. 3 000 chars of prefix + 1 500
// chars of suffix tends to fit inside an 8 K-context coder model with
// room left for the response. Tune if a model's context grows.
const PREFIX_CHAR_BUDGET = 3000;
const SUFFIX_CHAR_BUDGET = 1500;

/**
 * Wires Monaco's inline-completions provider to Ollama via the user's
 * configured endpoint and chat-selected model (or the explicit override
 * in `aiSettings.inlineCompletions.model`). Off by default — only mounts
 * the provider when `aiSettings.inlineCompletions.enabled` is true.
 *
 * Implements issue #258. Tab accepts and Esc dismisses through Monaco's
 * default keymap; nothing extra to wire.
 */
export function useInlineCompletions(monaco: Monaco | null): void {
  const { aiSettings } = useSettings();
  const inline = aiSettings.inlineCompletions;

  useEffect(() => {
    if (!monaco) return;
    if (!inline.enabled) return;
    if (!aiSettings.endpoint) return;

    let cancelled = false;

    // Register the provider against the catch-all language pattern so we
    // do not need a per-language hook. Returns a disposable we tear down
    // when the effect cleans up.
    const provider: languages.InlineCompletionsProvider = {
      async provideInlineCompletions(
        model: MonacoEditor.ITextModel,
        position: Position,
        _context: languages.InlineCompletionContext,
        token: CancellationToken,
      ): Promise<languages.InlineCompletions | null> {
        if (cancelled || token.isCancellationRequested) return null;

        // Debounce by sleeping; Monaco cancels stale invocations via
        // `token.isCancellationRequested` when the user keeps typing.
        await sleep(inline.debounceMs);
        if (token.isCancellationRequested) return null;

        // Resolve the model: explicit override wins, otherwise reuse the
        // last chat-selected model so the user does not have to configure
        // it twice.
        let modelId = inline.model.trim();
        if (!modelId) {
          modelId = (await trixtyStore.get<string | null>(
            "trixty_ai_last_model",
            null,
          )) ?? "";
        }
        if (!modelId) return null;
        if (token.isCancellationRequested) return null;

        const fullText = model.getValue();
        const offset = model.getOffsetAt(position);
        const prefix = fullText.slice(Math.max(0, offset - PREFIX_CHAR_BUDGET), offset);
        const suffix = fullText.slice(offset, offset + SUFFIX_CHAR_BUDGET);

        // Bridge Monaco's CancellationToken into a standard AbortSignal so
        // the network call tears down promptly when the user keeps typing.
        const controller = new AbortController();
        const tokenListener = token.onCancellationRequested(() => controller.abort());

        try {
          const completion = await requestInlineCompletion({
            endpoint: aiSettings.endpoint,
            model: modelId,
            prefix,
            suffix,
            maxTokens: Math.max(8, inline.maxTokens),
            signal: controller.signal,
          });
          if (!completion || cancelled || token.isCancellationRequested) return null;

          return {
            items: [
              {
                insertText: completion,
                range: new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column,
                ),
              },
            ],
          };
        } catch (err) {
          logger.debug("[useInlineCompletions] provider error:", err);
          return null;
        } finally {
          tokenListener.dispose();
        }
      },
      disposeInlineCompletions() {
        // Nothing to dispose — `items` are plain objects, no cached state.
      },
    };

    const disposable = monaco.languages.registerInlineCompletionsProvider("*", provider);

    return () => {
      cancelled = true;
      disposable.dispose();
    };
  }, [
    monaco,
    inline.enabled,
    inline.model,
    inline.debounceMs,
    inline.maxTokens,
    aiSettings.endpoint,
  ]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
