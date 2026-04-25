import { GoogleGenAI, SchemaType } from '@google/genai';
import { OpenRouter } from '@openrouter/sdk';
import { listen } from "@tauri-apps/api/event";
import { safeInvoke } from "@/api/tauri";
import { logger } from "@/lib/logger";
import { ChatMessage } from "@/context/ChatContext";
import { OllamaStreamFinalMessage } from "./ollamaStream";

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
    let body: any = null;

    if (init?.body) {
      try {
        body = JSON.parse(init.body as string);
      } catch {
        body = init.body;
      }
    }

    const isStream = body?.stream === true || targetUrl.includes('stream') || (init?.headers as any)?.Accept?.includes('text/event-stream');

    if (isStream) {
      const streamId = `stream_${Math.random().toString(36).slice(2, 11)}`;
      
      const readable = new ReadableStream({
        async start(controller) {
          const unlisten = await listen("ollama-stream", (event: any) => {
            const payload = event.payload;
            if (payload.streamId !== streamId) return;

            if (payload.kind === "delta" && payload.content) {
              controller.enqueue(new TextEncoder().encode(payload.content));
            } else if (payload.kind === "done") {
              // OpenRouter/OpenAI usually don't send a final 'done' string in the body like Ollama,
              // but our Rust proxy might be wrapping it. 
              // Actually, for generic proxying, we should just pass the raw chunks.
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

// --- TRANSFORMERS ---

function toGeminiContents(messages: any[]) {
  // Filter out system messages as they go into systemInstruction
  return messages
    .filter(msg => msg.role !== 'system')
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content || msg.text || '' }]
    }));
}

function toOpenAIMessages(messages: any[]) {
  return messages.map(msg => ({
    role: msg.role === 'ai' ? 'assistant' : msg.role,
    content: msg.content || msg.text || ''
  }));
}

// --- ADAPTERS ---

export async function streamGeminiChat(
  apiKey: string,
  model: string,
  messages: any[],
  options: { temperature: number; maxTokens: number; tools?: any[]; think?: boolean },
  onDelta: (content: string) => void,
  abortSignal: AbortSignal,
) {
  try {
    const ai = new GoogleGenAI({ 
      apiKey,
      fetch: createProxyFetch() as any
    });

    const geminiModel = ai.models.get(model);
    const contents = toGeminiContents(messages);
    const systemMsg = messages.find(m => m.role === 'system');

    const result = await geminiModel.generateContentStream({
      contents,
      systemInstruction: systemMsg ? systemMsg.content || systemMsg.text : undefined,
      config: {
        temperature: options.temperature,
        maxOutputTokens: options.maxTokens,
      }
    });

    let fullText = "";
    for await (const chunk of result.stream) {
      if (abortSignal.aborted) break;
      const text = chunk.text();
      if (text) {
        fullText += text;
        onDelta(text);
      }
    }

    const finalMessage: OllamaStreamFinalMessage = {
      role: "assistant",
      content: fullText
    };

    return { ok: true, status: 200, message: finalMessage };
  } catch (err: any) {
    logger.error("[Gemini Adapter] Stream error:", err);
    return { ok: false, status: 500, errorText: err.message };
  }
}

export async function streamOpenRouterChat(
  apiKey: string,
  model: string,
  messages: any[],
  options: { temperature: number; maxTokens: number; tools?: any[]; think?: boolean },
  onDelta: (content: string) => void,
  abortSignal: AbortSignal,
) {
  try {
    const openRouter = new OpenRouter({
      apiKey,
      fetch: createProxyFetch() as any
    });

    const stream = await openRouter.chat.completions.create({
      model,
      messages: toOpenAIMessages(messages) as any,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
    });

    let fullText = "";
    for await (const chunk of stream) {
      if (abortSignal.aborted) break;
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        fullText += content;
        onDelta(content);
      }
    }

    const finalMessage: OllamaStreamFinalMessage = {
      role: "assistant",
      content: fullText
    };

    return { ok: true, status: 200, message: finalMessage };
  } catch (err: any) {
    logger.error("[OpenRouter Adapter] Stream error:", err);
    return { ok: false, status: 500, errorText: err.message };
  }
}
