"use client";

import type { ProviderId } from "@/context/SettingsContext";

/**
 * Tool definitions follow OpenAI's canonical shape — same one IDE_TOOLS
 * uses today. Other providers (Anthropic, Gemini) have their own
 * envelopes; we translate per-provider in `translateToolsForProvider`.
 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * Unified tool-call shape returned by every cloud provider's adapter.
 * Mirrors Ollama's `OllamaStreamFinalMessage.tool_calls` so the agent
 * loop in `AiChatComponent` can consume both Ollama and cloud results
 * with the same downstream code path. `arguments` is a JSON-encoded
 * string regardless of how the provider transports it on the wire
 * (OpenAI = string, Anthropic = object, Gemini = object).
 */
export interface UnifiedToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

type CloudProvider = Exclude<ProviderId, "ollama">;

/**
 * Translate the OpenAI-canonical tool list into each provider's
 * native shape. Returns `undefined` so the caller can fold it into
 * the request body without an extra branch.
 */
export function translateToolsForProvider(
  provider: CloudProvider,
  tools: ToolDefinition[] | undefined,
): unknown | undefined {
  if (!tools || tools.length === 0) return undefined;
  switch (provider) {
    case "openai":
    case "openrouter":
      return tools;
    case "anthropic":
      // Anthropic flattens the function envelope — `name`, `description`,
      // `input_schema` (= our `parameters`) at the top level. Strip the
      // OpenAI wrapper.
      return tools.map((t) => ({
        name: t.function.name,
        description: t.function.description ?? "",
        input_schema: t.function.parameters ?? {
          type: "object",
          properties: {},
        },
      }));
    case "gemini":
      // Gemini buckets every declaration under one outer `tools[]` entry
      // with a `functionDeclarations` array. Same field names as
      // OpenAI's `function` block once you strip the wrapper.
      return [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.function.name,
            description: t.function.description ?? "",
            parameters: t.function.parameters ?? {
              type: "object",
              properties: {},
            },
          })),
        },
      ];
  }
}

/**
 * Per-provider parse of a non-streaming chat completion body into the
 * unified tool-call list. Returns an empty array when the model
 * answered with text only.
 */
export function extractToolCallsFromBody(
  provider: CloudProvider,
  body: string,
): UnifiedToolCall[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const obj = parsed as Record<string, unknown>;

  switch (provider) {
    case "openai":
    case "openrouter": {
      const choices = obj.choices as
        | Array<{
            message?: {
              tool_calls?: Array<{
                id?: string;
                type?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>
        | undefined;
      const calls = choices?.[0]?.message?.tool_calls ?? [];
      return calls
        .filter((c) => c.function?.name)
        .map((c) => ({
          id: c.id ?? randomToolCallId(),
          type: "function" as const,
          function: {
            name: c.function!.name!,
            arguments: c.function!.arguments ?? "",
          },
        }));
    }
    case "anthropic": {
      const content = obj.content as
        | Array<{
            type: string;
            id?: string;
            name?: string;
            input?: unknown;
          }>
        | undefined;
      const calls = (content ?? []).filter((b) => b.type === "tool_use");
      return calls
        .filter((c) => c.name)
        .map((c) => ({
          id: c.id ?? randomToolCallId(),
          type: "function" as const,
          function: {
            name: c.name!,
            arguments: JSON.stringify(c.input ?? {}),
          },
        }));
    }
    case "gemini": {
      const candidates = obj.candidates as
        | Array<{
            content?: {
              parts?: Array<{
                functionCall?: { name?: string; args?: unknown };
              }>;
            };
          }>
        | undefined;
      const calls =
        candidates
          ?.flatMap((c) => c.content?.parts ?? [])
          .filter((p) => p.functionCall?.name) ?? [];
      return calls.map((p) => ({
        // Gemini doesn't mint ids — synthesise one. The same id is
        // echoed in the tool-result message so the model can tie the
        // call to its result.
        id: randomToolCallId(),
        type: "function" as const,
        function: {
          name: p.functionCall!.name!,
          arguments: JSON.stringify(p.functionCall!.args ?? {}),
        },
      }));
    }
  }
}

/**
 * Internal canonical history entry the renderer maintains across
 * agent turns. `assistant_with_tools` is the assistant turn that
 * carries one or more tool_calls; `tool_result` is the user-side
 * response carrying the tool's output. Each cloud provider gets its
 * own translation in `translateHistoryForProvider`.
 */
export type CanonicalHistoryEntry =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | {
      role: "assistant_with_tools";
      content: string;
      tool_calls: UnifiedToolCall[];
    }
  | {
      role: "tool_result";
      tool_call_id: string;
      tool_name: string;
      content: string;
    };

/**
 * Translate the renderer's canonical history into the provider's
 * expected `messages` / `contents` shape. Returns the bundle the
 * `cloudChat` request needs (Anthropic separates `system`, Gemini
 * uses `systemInstruction`, the OpenAI-likes inline system rows).
 */
export interface TranslatedHistory {
  system?: string;
  messages?: unknown[]; // OpenAI / Anthropic
  contents?: unknown[]; // Gemini
  systemInstruction?: unknown; // Gemini
}

export function translateHistoryForProvider(
  provider: CloudProvider,
  history: CanonicalHistoryEntry[],
): TranslatedHistory {
  const systemEntries = history
    .filter((e): e is { role: "system"; content: string } => e.role === "system")
    .map((e) => e.content)
    .join("\n\n")
    .trim();

  switch (provider) {
    case "openai":
    case "openrouter": {
      const messages: unknown[] = [];
      if (systemEntries) {
        messages.push({ role: "system", content: systemEntries });
      }
      for (const entry of history) {
        if (entry.role === "system") continue;
        if (entry.role === "user") {
          messages.push({ role: "user", content: entry.content });
        } else if (entry.role === "assistant") {
          messages.push({ role: "assistant", content: entry.content });
        } else if (entry.role === "assistant_with_tools") {
          messages.push({
            role: "assistant",
            content: entry.content || null,
            tool_calls: entry.tool_calls,
          });
        } else if (entry.role === "tool_result") {
          messages.push({
            role: "tool",
            tool_call_id: entry.tool_call_id,
            content: entry.content,
          });
        }
      }
      return { messages };
    }
    case "anthropic": {
      const messages: unknown[] = [];
      // Anthropic refuses leading consecutive user messages mixed with
      // tool_results — group them strictly. We emit each canonical
      // entry as one message in order; the spec allows alternating
      // `user` / `assistant` so a tool_result lives in a `user` turn
      // immediately after the `assistant` tool_use turn.
      let pendingToolResults: unknown[] = [];
      const flushToolResults = () => {
        if (pendingToolResults.length === 0) return;
        messages.push({ role: "user", content: pendingToolResults });
        pendingToolResults = [];
      };
      for (const entry of history) {
        if (entry.role === "system") continue;
        if (entry.role === "user") {
          flushToolResults();
          messages.push({ role: "user", content: entry.content });
        } else if (entry.role === "assistant") {
          flushToolResults();
          messages.push({ role: "assistant", content: entry.content });
        } else if (entry.role === "assistant_with_tools") {
          flushToolResults();
          const blocks: unknown[] = [];
          if (entry.content) {
            blocks.push({ type: "text", text: entry.content });
          }
          for (const call of entry.tool_calls) {
            let input: unknown = {};
            try {
              input = JSON.parse(call.function.arguments || "{}");
            } catch {
              // Tolerate malformed JSON the model emitted — Anthropic
              // expects an object, so we send `{}` rather than failing
              // the whole turn.
              input = {};
            }
            blocks.push({
              type: "tool_use",
              id: call.id,
              name: call.function.name,
              input,
            });
          }
          messages.push({ role: "assistant", content: blocks });
        } else if (entry.role === "tool_result") {
          pendingToolResults.push({
            type: "tool_result",
            tool_use_id: entry.tool_call_id,
            content: entry.content,
          });
        }
      }
      flushToolResults();
      return { system: systemEntries || undefined, messages };
    }
    case "gemini": {
      const contents: unknown[] = [];
      for (const entry of history) {
        if (entry.role === "system") continue;
        if (entry.role === "user") {
          contents.push({
            role: "user",
            parts: [{ text: entry.content }],
          });
        } else if (entry.role === "assistant") {
          contents.push({
            role: "model",
            parts: [{ text: entry.content }],
          });
        } else if (entry.role === "assistant_with_tools") {
          const parts: unknown[] = [];
          if (entry.content) parts.push({ text: entry.content });
          for (const call of entry.tool_calls) {
            let args: unknown = {};
            try {
              args = JSON.parse(call.function.arguments || "{}");
            } catch {
              args = {};
            }
            parts.push({
              functionCall: { name: call.function.name, args },
            });
          }
          contents.push({ role: "model", parts });
        } else if (entry.role === "tool_result") {
          let response: unknown;
          try {
            response = JSON.parse(entry.content);
          } catch {
            // Gemini's `functionResponse.response` field requires an
            // object; wrap plain strings so they survive the round-trip.
            response = { result: entry.content };
          }
          if (typeof response !== "object" || response === null) {
            response = { result: entry.content };
          }
          contents.push({
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: entry.tool_name,
                  response,
                },
              },
            ],
          });
        }
      }
      const systemInstruction = systemEntries
        ? { role: "user", parts: [{ text: systemEntries }] }
        : undefined;
      return { contents, systemInstruction };
    }
  }
}

function randomToolCallId(): string {
  return `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
