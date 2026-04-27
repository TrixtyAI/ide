import { GoogleGenAI } from '@google/genai';
import { OpenRouter } from '@openrouter/sdk';
import { listen } from "@tauri-apps/api/event";
import { safeInvoke } from "@/api/tauri";
import { logger } from "@/lib/logger";
import { OllamaStreamFinalMessage, OllamaStreamEvent } from "./ollamaStream";

interface ProviderMessage {
  role: string;
  content?: string;
  text?: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> }; id?: string; type?: string }[];
  tool_call_id?: string;
}

/**
 * Creates a standard 'fetch' implementation that routes through the Tauri Rust proxy.
 * This bypasses CORS and keeps the API keys out of the browser's Network tab (mostly).
 * It supports both standard and streaming (SSE) responses by mocking a ReadableStream.
 */
function createProxyFetch() {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const targetUrl = url.toString();
    const method = init?.method || 'GET';
    const headers = init?.headers ? (init.headers as Record<string, string>) : {};
    let body: Record<string, unknown> | null = null;

    if (init?.body) {
      try {
        if (typeof init.body === 'string') {
          body = JSON.parse(init.body);
        } else {
          body = null;
        }

        // --- TRUCO DE COMPATIBILIDAD ---
        // Si el SDK envolvió todo en 'chatRequest', lo aplanamos para el servidor
        if (body && typeof body === 'object' && 'chatRequest' in body) {
          const wrapper = body as { chatRequest: Record<string, unknown> };
          body = wrapper.chatRequest;
        }
      } catch {
        body = null;
      }
    }

    const isStream = body?.stream === true || targetUrl.includes('stream') || (init?.headers as Record<string, string>)?.Accept?.includes('text/event-stream');

    if (isStream) {
      const streamId = `stream_${Math.random().toString(36).slice(2, 11)}`;
      
      const readable = new ReadableStream({
        async start(controller) {
          const unlisten = await listen<OllamaStreamEvent>("ollama-stream", (event) => {
            const payload = event.payload;
            if (payload.streamId !== streamId) return;

            if (payload.kind === "delta" && payload.content) {
              controller.enqueue(new TextEncoder().encode(payload.content));
            } else if (payload.kind === "done") {
              controller.close();
              unlisten();
            } else if (payload.kind === "error") {
              controller.error(new Error(payload.error || "Stream error"));
              unlisten();
            }
          });

          try {
            await safeInvoke("ollama_proxy_stream", {
              streamId,
              method,
              url: targetUrl,
              headers,
              body: body || {},
              rawMode: true
            });
          } catch (err) {
            controller.error(err);
            unlisten();
          }
        }
      });

      return new Response(readable, {
        status: 200,
        headers: new Headers({ 'Content-Type': 'text/event-stream' })
      });
    } else {
      // Non-streaming request
      const response = await safeInvoke("ollama_proxy", {
        method,
        url: targetUrl,
        headers,
        body: body || {}
      });

      return new Response(response.body, {
        status: response.status,
        headers: new Headers({ 'Content-Type': 'application/json' })
      });
    }
  };
}

// --- TOOL FORMAT CONVERTERS ---

/**
 * Converts the OpenAI-format IDE_TOOLS array to Gemini's functionDeclarations
 * format. Gemini expects: `[{ functionDeclarations: [{ name, description, parameters }] }]`
 */
function toGeminiTools(tools: unknown[]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const declarations = tools
    .filter((t: unknown) => (t as { type: string }).type === 'function')
    .map((t: unknown) => {
      const fn = (t as { function: { name: string; description: string; parameters: unknown } }).function;
      return {
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
      };
    });
  if (declarations.length === 0) return undefined;
  return [{ functionDeclarations: declarations }];
}

// --- MESSAGE TRANSFORMERS ---

function toGeminiContents(messages: ProviderMessage[]) {
  // Filter out system messages as they go into systemInstruction
  return messages
    .filter(msg => msg.role !== 'system')
    .map(msg => {
      // Tool result messages → functionResponse part
      if (msg.role === 'tool' && msg.tool_call_id) {
        return {
          role: 'user',
          parts: [{
            functionResponse: {
              name: msg.tool_call_id,
              response: { result: msg.content || msg.text || '' }
            }
          }]
        };
      }
      // Assistant messages with tool_calls → functionCall parts
      if ((msg.role === 'assistant' || msg.role === 'ai') && msg.tool_calls && msg.tool_calls.length > 0) {
        const parts = msg.tool_calls.map(tc => ({
          functionCall: {
            name: tc.function.name,
            args: tc.function.arguments
          }
        }));
        // If there's also text content, prepend it
        if (msg.content || msg.text) {
          parts.unshift({ text: msg.content || msg.text || '' } as unknown as typeof parts[0]);
        }
        return { role: 'model', parts };
      }
      // Regular user/assistant messages
      return {
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content || msg.text || '' }]
      };
    });
}

function toOpenAIMessages(messages: ProviderMessage[]) {
  return messages.map(msg => {
    // Tool result messages
    if (msg.role === 'tool') {
      return {
        role: 'tool' as const,
        content: msg.content || msg.text || '',
        tool_call_id: msg.tool_call_id || '',
      };
    }
    // Assistant messages with tool_calls
    if ((msg.role === 'assistant' || msg.role === 'ai') && msg.tool_calls && msg.tool_calls.length > 0) {
      return {
        role: 'assistant' as const,
        content: msg.content || msg.text || null,
        tool_calls: msg.tool_calls.map((tc, idx) => ({
          id: tc.id || `call_${idx}`,
          type: 'function' as const,
          function: {
            name: tc.function.name,
            arguments: typeof tc.function.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function.arguments),
          }
        })),
      };
    }
    // Regular messages
    return {
      role: msg.role === 'ai' ? 'assistant' as const : msg.role as 'user' | 'system' | 'assistant',
      content: msg.content || msg.text || ''
    };
  });
}

// --- ADAPTERS ---

// Gemini SDK chunk shape — loosened so we don't need to import the full SDK
// type surface. Only the fields we inspect are typed here.
interface GeminiChunk {
  text: () => string;
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        functionCall?: { name: string; args: Record<string, unknown> };
      }[];
    };
  }[];
}

export async function streamGeminiChat(
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
  options: { temperature: number; maxTokens: number; tools?: unknown[]; think?: boolean },
  onDelta: (content: string) => void,
  abortSignal: AbortSignal,
) {
  try {
    const ai = new (GoogleGenAI as unknown as new (opt: { apiKey: string }) => { 
      models: { generateContentStream: (p: unknown) => Promise<{ stream: AsyncIterable<GeminiChunk> }> }
    })({ apiKey });
    // Custom fetch for proxy support
    (ai as unknown as { fetch: unknown }).fetch = createProxyFetch();

    const contents = toGeminiContents(messages);
    const systemMsg = messages.find(m => m.role === 'system');
    const geminiTools = options.tools ? toGeminiTools(options.tools) : undefined;

    const result = await ai.models.generateContentStream({
      model,
      contents,
      systemInstruction: systemMsg ? systemMsg.content || systemMsg.text : undefined,
      config: {
        temperature: options.temperature,
        maxOutputTokens: options.maxTokens,
        ...(geminiTools ? { tools: geminiTools } : {}),
      }
    });

    let fullText = "";
    const toolCalls: OllamaStreamFinalMessage['tool_calls'] = [];

    for await (const chunk of result.stream) {
      if (abortSignal.aborted) break;

      // Check for function calls in the response parts
      const candidates = chunk.candidates;
      if (candidates) {
        for (const candidate of candidates) {
          const parts = candidate.content?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.functionCall) {
                toolCalls.push({
                  function: {
                    name: part.functionCall.name,
                    arguments: part.functionCall.args as Record<string, string | number | boolean | string[]>,
                  },
                  id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  type: 'function',
                });
              } else if (part.text) {
                fullText += part.text;
                onDelta(part.text);
              }
            }
          }
        }
      } else {
        // Fallback: use the text() helper if candidates aren't exposed
        try {
          const text = chunk.text();
          if (text) {
            fullText += text;
            onDelta(text);
          }
        } catch {
          // text() throws if the chunk is a function call; already handled above
        }
      }
    }

    const finalMessage: OllamaStreamFinalMessage = {
      role: "assistant",
      content: fullText,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };

    return { ok: true, status: 200, message: finalMessage };
  } catch (err: unknown) {
    const error = err as Error;
    logger.error("Gemini Stream Error:", error);
    return { ok: false, status: 500, errorText: error.message };
  }
}

// OpenRouter streaming chunk shape (OpenAI-compatible)
interface OpenRouterStreamChunk {
  choices: {
    delta: {
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }[];
    };
    finish_reason?: string;
  }[];
}

export async function streamOpenRouterChat(
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
  options: { temperature: number; maxTokens: number; tools?: unknown[]; think?: boolean },
  onDelta: (content: string) => void,
  abortSignal: AbortSignal,
) {
  try {
    const openRouter = new OpenRouter({
      apiKey,
    });
    
    // Inyectamos el proxy fetch para que Tauri maneje la petición
    (openRouter as unknown as { fetch: unknown }).fetch = createProxyFetch();

    const chatRequest: Record<string, unknown> = {
      model,
      messages: toOpenAIMessages(messages) as never,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      stream: true,
    };

    // Pass tools to the API if provided
    if (options.tools && options.tools.length > 0) {
      chatRequest.tools = options.tools;
      chatRequest.tool_choice = 'auto';
    }

    const stream = await openRouter.chat.send({
      chatRequest: chatRequest as never,
    });

    let fullText = "";
    // Accumulate streamed tool_calls. OpenAI streaming splits tool calls
    // across multiple chunks: the first chunk for a given index carries
    // `id` + `function.name`, subsequent ones append to `function.arguments`.
    const toolCallAccumulator: Map<number, {
      id: string;
      type: string;
      name: string;
      arguments: string;
    }> = new Map();

    for await (const chunk of stream as AsyncIterable<OpenRouterStreamChunk>) {
      if (abortSignal.aborted) break;

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;

      // Handle text content
      const content = delta?.content || "";
      if (content) {
        fullText += content;
        onDelta(content);
      }

      // Handle streamed tool calls
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          const existing = toolCallAccumulator.get(idx);
          if (existing) {
            // Append to existing tool call (arguments come in fragments)
            if (tc.function?.arguments) {
              existing.arguments += tc.function.arguments;
            }
          } else {
            // New tool call entry
            toolCallAccumulator.set(idx, {
              id: tc.id || `or_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: tc.type || 'function',
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
            });
          }
        }
      }
    }

    // Convert accumulated tool calls to the final message format
    const toolCalls: OllamaStreamFinalMessage['tool_calls'] = [];
    for (const [, tc] of toolCallAccumulator) {
      let parsedArgs: Record<string, string | number | boolean | string[]> = {};
      try {
        parsedArgs = JSON.parse(tc.arguments);
      } catch {
        logger.warn("[OpenRouter] Failed to parse tool call arguments:", tc.arguments);
      }
      toolCalls.push({
        function: {
          name: tc.name,
          arguments: parsedArgs,
        },
        id: tc.id,
        type: tc.type,
      });
    }

    const finalMessage: OllamaStreamFinalMessage = {
      role: "assistant",
      content: fullText,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };

    return { ok: true, status: 200, message: finalMessage };
  } catch (err: unknown) {
    const error = err as Error;
    logger.error("OpenRouter SDK Error:", error);
    return { ok: false, status: 500, errorText: error.message };
  }
}
