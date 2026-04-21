"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, Send, Sparkles, Brain, Code2, ChevronDown, History, Plus, Trash2, MessageSquare, Save, Square, Download, Lock } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useAgent } from "@/context/AgentContext";
import ReactMarkdown from "react-markdown";
import { trixtyStore } from "@/api/store";
import { useL10n } from "@/hooks/useL10n";
import remarkGfm from "remark-gfm";
import { safeInvoke as invoke, type OllamaRequest } from "@/api/tauri";
import { IDE_TOOLS } from "./tools";
import { getSystemInfo, detectProjectStack, generateAwarenessBlock } from "@/lib/awareness";
import { useClickOutside } from "@/hooks/useClickOutside";
import { logger } from "@/lib/logger";

type ToolArgs = Record<string, string | number | boolean | string[]>;

interface OllamaModel {
  name: string;
  size: number;
  details: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

interface PendingTool {
  id: string;
  name: string;
  args: Record<string, string | number | boolean | string[]>;
}

type OllamaChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: string[] }
  | { role: 'assistant'; content: string; tool_calls?: { function: { name: string, arguments: ToolArgs }; id?: string; type?: string }[]; thinking?: string }
  | { role: 'tool'; content: string; tool_call_id: string };


const AiChatComponent: React.FC = () => {
  const {
    setRightPanelOpen,
    rootPath,
    openFiles,
    currentFile,
    chatSessions,
    activeSessionId,
    createSession,
    deleteSession,
    switchSession,
    addMessageToSession,
    updateAISettings,
    aiSettings,
    editorSettings,
    systemSettings,
    locale
  } = useApp();
  const {
    chatMode, setChatMode, getSystemPrompt,
    skills, activeSkills, docs, activeDocs, refreshAgentData
  } = useAgent();
  const { t } = useL10n();

  const activeSession = chatSessions.find(s => s.id === activeSessionId);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [isTyping, setIsTyping] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'connected' | 'not_found'>('checking');
  const [projectTree, setProjectTree] = useState<string[]>([]);
  const [pendingTool, setPendingTool] = useState<PendingTool | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Per-call permission resolvers. Previously a single `window.resolveTool`
  // held the in-flight resolver globally, which meant two concurrent
  // permission prompts (two chat submissions racing, or a tool-call loop
  // overlapping with a retry) would silently overwrite the first resolver
  // and leave the first Promise dangling forever. A Map keyed by call id
  // keeps each prompt independent; on unmount we resolve everything as
  // denied so pending awaiters don't leak past the component's lifetime.
  const pendingResolversRef = useRef<Map<string, (allowed: boolean) => void>>(new Map());
  useEffect(() => {
    const resolvers = pendingResolversRef.current;
    return () => {
      for (const resolver of resolvers.values()) resolver(false);
      resolvers.clear();
    };
  }, []);

  useEffect(() => {
    // Load last used model from storage
    let cancelled = false;
    const loadLastModel = async () => {
      const savedModel = await trixtyStore.get<string | null>("trixty_ai_last_model", null);
      if (cancelled) return;
      if (savedModel) setSelectedModel(savedModel);
    };
    loadLastModel();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedModel) {
      trixtyStore.set("trixty_ai_last_model", selectedModel);
    }
  }, [selectedModel]);

  const proxyFetch = useCallback(async (url: string, method: string = "GET", body?: OllamaRequest) => {
    // Sanitize the URL to avoid double slashes if endpoint has trailing slash
    const sanitizedUrl = url.replace(/([^:]\/)\/+/g, "$1");

    const result = await invoke("ollama_proxy", {
      method,
      url: sanitizedUrl,
      body: body || { type: 'version' } // Default to version if no body
    });
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => JSON.parse(result.body),
      text: async () => result.body
    };
  }, []);

  // Fetch project tree
  useEffect(() => {
    const fetchTree = async () => {
      if (!rootPath) {
        setProjectTree([]);
        return;
      }
      try {
        const files = await invoke("get_recursive_file_list", { rootPath });
        setProjectTree(files);
      } catch (err) {
        logger.error("Failed to fetch project tree:", err);
      }
    };
    fetchTree();
  }, [rootPath]);

  // Fetch Ollama models.
  // `selectedModel` is intentionally NOT in the dependency array: the effect
  // itself writes to it, which would otherwise retrigger the fetch in a loop.
  // We use the functional form of `setSelectedModel` to read the latest value
  // without taking a dependency on it.
  useEffect(() => {
    let cancelled = false;
    const fetchModels = async () => {
      try {
        setOllamaStatus('checking');
        const response = await proxyFetch(`${aiSettings.endpoint}/api/tags`);
        const data = await response.json();
        if (cancelled) return;
        if (data.models) {
          const models: OllamaModel[] = data.models;
          setModels(models);
          setOllamaStatus('connected');
          if (models.length > 0) {
            const savedModel = await trixtyStore.get<string | null>("trixty_ai_last_model", null);
            if (cancelled) return;
            const exists = models.find((m) => m.name === savedModel);
            if (savedModel && exists) {
              setSelectedModel(savedModel);
            } else {
              // Validate the current `prev` against the freshly fetched list too —
              // switching endpoints (e.g. to a different Ollama instance) can leave
              // `prev` pointing at a model that no longer exists.
              setSelectedModel((prev) =>
                prev && models.some((m) => m.name === prev) ? prev : models[0].name
              );
            }
          }
        } else {
          setOllamaStatus('not_found');
        }
      } catch (err) {
        if (cancelled) return;
        logger.error("Failed to fetch Ollama models:", err);
        setOllamaStatus('not_found');
      }
    };
    fetchModels();
    return () => {
      cancelled = true;
    };
  }, [aiSettings.endpoint, proxyFetch]);


  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeSession?.messages, isTyping]);

  // Close menus on click outside
  useClickOutside(menuRef, () => setShowModelMenu(false));

  const getModelFamilyIcon = (family: string) => {
    const f = family.toLowerCase();
    if (f.includes('llama')) return <Sparkles size={14} className="text-white/40" />;
    if (f.includes('deepseek')) return <Brain size={14} className="text-white/40" />;
    if (f.includes('mistral') || f.includes('mixtral')) return <Code2 size={14} className="text-white/40" />;
    return <MessageSquare size={14} className="text-white/40" />;
  };

  const getModelColor = (family: string) => {
    const f = family.toLowerCase();
    if (f.includes('llama')) return 'border-blue-500/20 bg-blue-500/5 text-blue-300';
    if (f.includes('deepseek')) return 'border-yellow-500/20 bg-yellow-500/5 text-yellow-500';
    if (f.includes('mistral')) return 'border-orange-500/20 bg-orange-500/5 text-orange-400';
    return 'border-white/10 bg-white/5 text-white/50';
  };
  useEffect(() => {
    if (!isTyping || !activeSessionId) return;

    let warningShown = false;
    const interval = setInterval(async () => {
      try {
        const stats = await invoke("get_system_health");

        // Hard Stop at 97%
        if (stats.cpu_usage > 97 || stats.memory_usage > 97) {
          handleStop();
          unloadModel(); // Crucial: clear RAM/VRAM immediately
          addMessageToSession(activeSessionId, {
            role: "warning",
            text: t('ai.freeze_stop_msg')
          });
          clearInterval(interval);
          return;
        }

        // Warning at 90%
        if (!warningShown && (stats.cpu_usage > 90 || stats.memory_usage > 90)) {
          addMessageToSession(activeSessionId, {
            role: "warning",
            text: t('ai.freeze_warning_msg')
          });
          warningShown = true;
        }
      } catch (err) {
        logger.error("System monitor error:", err);
      }
    }, 2000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTyping, aiSettings.freezeProtection, activeSessionId]);




  const resolvePath = (p: string) => {
    if (!rootPath) return p;
    // Check if it's already an absolute path
    if (p.startsWith('/') || p.match(/^[a-zA-Z]:[\\/]/)) return p;
    // Join with root
    const separator = rootPath.includes('\\') ? '\\' : '/';
    const cleanRoot = rootPath.endsWith(separator) ? rootPath : rootPath + separator;
    return cleanRoot + p;
  };

  const executeToolInternal = async (name: string, args: Record<string, string | number | boolean | string[]>) => {
    try {
      switch (name) {
        case 'list_directory':
          return await invoke("read_directory", { path: resolvePath(String(args.path)) });
        case 'read_file':
          return await invoke("read_file", { path: resolvePath(String(args.path)) });
        case 'write_file':
          await invoke("write_file", { path: resolvePath(String(args.path)), content: String(args.content) });
          return "File written successfully.";
        case 'execute_command':
          return await invoke("execute_command", {
            command: String(args.command),
            args: Array.isArray(args.args) ? args.args.map(String) : [],
            cwd: typeof args.cwd === 'string' ? args.cwd : rootPath
          });
        case 'get_workspace_structure':
          return await invoke("get_recursive_file_list", { rootPath });
        case 'web_search':
          return await invoke("perform_web_search", { query: String(args.query) });
        case 'remember':
          await invoke("write_file", {
            path: resolvePath(".agents/MEMORY.md"),
            content: String(args.content)
          });
          // Refresh context so the memory visualizer updates
          try {
            await refreshAgentData();
          } catch {}
          return "Memory updated successfully.";
        default:
          return `Error: Unknown tool ${name}`;
      }
    } catch (err: unknown) {
      return `Error executing tool ${name}: ${err instanceof Error ? err.message : String(err)}`;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTyping(false);
  };

  const unloadModel = async () => {
    if (!selectedModel || !aiSettings.endpoint) return;
    try {
      await proxyFetch(`${aiSettings.endpoint}/api/generate`, "POST", {
        type: 'generate',
        model: selectedModel,
        keep_alive: 0
      });
    } catch (err) {
      logger.error("Failed to unload model:", err);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !selectedModel || isTyping || !activeSessionId || !activeSession) return;

    const userMessage = input;
    addMessageToSession(activeSessionId, { role: "user", text: userMessage });
    setInput("");
    setIsTyping(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Build context for the system prompt
      const workspaceContext = rootPath ? `Workspace Root: ${rootPath}\n` : "";
      const currentContext = currentFile ? `${t('ai.context.focused_file')}: ${currentFile.path}\n` : "";

      // Fetch dynamic awareness data
      const systemInfo = await getSystemInfo();
      const projectStack = await detectProjectStack(rootPath);
      const awarenessBlock = generateAwarenessBlock({
        system: systemInfo,
        stack: projectStack,
        settings: {
          ai: aiSettings,
          editor: editorSettings,
          system: systemSettings,
          locale: locale
        },
        skills: skills.map(s => ({ id: s.id, name: s.name, active: activeSkills.includes(s.id) })),
        docs: docs.map(d => ({ id: d.id, name: d.name, active: activeDocs.includes(d.id) })),
        mode: chatMode,
        rootPath,
        internetAccess: chatMode === 'agent' ? "Enabled (via web_search tool)" : "Disabled",
        projectTreeSummary: projectTree
      });

      const systemPrompt = getSystemPrompt();

      const history: OllamaChatMessage[] = [
        {
          role: "system" as const,
          content: `${systemPrompt}\n\n${awarenessBlock}\n\n${workspaceContext}${currentContext}`
        },
        ...activeSession.messages.map((m): OllamaChatMessage => {
          if (m.role === "tool") {
            return { role: "tool" as const, content: m.text, tool_call_id: m.tool_id || "" };
          }
          if (m.role === "ai") {
            return {
              role: "assistant" as const,
              content: m.text,
              tool_calls: m.tool_calls,
            };
          }
          if (m.role === "user") {
            return {
              role: "user" as const,
              content: m.text,
            };
          }
          return {
            role: "system" as const,
            content: m.text,
          };
        }),
        { role: "user" as const, content: userMessage }
      ];

      let loop = true;
      let maxIterations = aiSettings.deepMode ? 15 : 5;

      while (loop && maxIterations > 0) {
        maxIterations--;
        let response;
        const body: OllamaRequest = {
            type: 'chat',

            model: selectedModel,
            messages: history,
            stream: false,
            tools: (() => {
              if (chatMode !== 'agent') return undefined;
              if (!rootPath) return undefined;
              return IDE_TOOLS;
            })(),
            think: aiSettings.deepMode,
            options: {
              temperature: aiSettings.temperature,
              num_predict: aiSettings.maxTokens,
            },
            keep_alive: `${aiSettings.keepAlive || 5}m`,
        };

        try {
            response = await proxyFetch(`${aiSettings.endpoint}/api/chat`, "POST", body);

            // If failed because model doesn't support 'think', retry without it
            if (!response.ok && aiSettings.deepMode) {
                const errorData = await response.json();
                if (response.status === 400 || (errorData.error && errorData.error.includes("think"))) {
                    logger.warn(`Model ${selectedModel} doesn't support Deep Thinking. Retrying without it.`);
                  const reqBody = { ...body, think: false };
                    response = await proxyFetch(`${aiSettings.endpoint}/api/chat`, "POST", reqBody);
                }
            }
        } catch (err) {
            throw err;
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || "Ollama Request Failed");
        }

        const data = await response.json();
        const message = data.message;

        if (message.tool_calls && message.tool_calls.length > 0) {
          // Add the assistant's tool call to history
          history.push(message);
          addMessageToSession(activeSessionId, {
            role: "ai",
            text: t('ai.status.interacting'),
            thinking: message.thinking,
            tool_calls: message.tool_calls
          });

          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            const toolArgs = toolCall.function.arguments;
            // Prefer the provider-supplied id; otherwise mint a collision-
            // resistant one. `Math.random().substr(2, 9)` (the previous shape)
            // has narrow entropy and could theoretically collide with a
            // still-pending entry in the resolver Map, which would silently
            // overwrite the earlier resolver and reintroduce the dangling-
            // Promise bug this whole path is trying to fix.
            const generatedId =
              typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `cid-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
            const callId = toolCall.id || generatedId;

            let result;
            if (aiSettings.alwaysAllowTools) {
              result = await executeToolInternal(toolName, toolArgs);
            } else {
              // Manual permission needed. The dialog UI has a single slot, so
              // any older unresolved prompt is already invisible to the user;
              // we deny them here instead of letting their Promises dangle.
              const permissionPromise = new Promise<boolean>((resolve) => {
                for (const [oldId, oldResolver] of pendingResolversRef.current) {
                  if (oldId !== callId) {
                    oldResolver(false);
                    pendingResolversRef.current.delete(oldId);
                  }
                }
                // Defense against a callId collision (e.g. provider reusing an
                // id): resolve the prior resolver as denied before replacing,
                // so no awaiter is left dangling.
                const existing = pendingResolversRef.current.get(callId);
                if (existing) existing(false);
                pendingResolversRef.current.set(callId, resolve);
                setPendingTool({ id: callId, name: toolName, args: toolArgs });
              });

              const allowed = await permissionPromise;
              if (allowed) {
                result = await executeToolInternal(toolName, toolArgs);
              } else {
                result = t('ai.error.user_denied');
              }
            }

            const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            history.push({
              role: "tool",
              content: resultStr,
              tool_call_id: callId
            });

            addMessageToSession(activeSessionId, {
              role: "tool",
              text: resultStr,
              tool_id: callId
            });
          }
          // Continue loop to get AI response for the tool results
        } else {
          addMessageToSession(activeSessionId, {
            role: "ai",
            text: message.content,
            thinking: message.thinking
          });
          loop = false;
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Do nothing, user stopped intentionally
      } else {
        // Check for OOM / Connection lost
        const isLikelyOOM = err instanceof Error && (err.message?.includes("Failed to fetch") || err.message?.includes("NetworkError"));
        const requestFailed = err instanceof Error && err.message?.includes("Ollama Request Failed");
        addMessageToSession(activeSessionId, {
          role: "ai",
          text: isLikelyOOM ? t('ai.error_oom') : (requestFailed ? t('ai.error.request_failed') : t('ai.error_connect', { endpoint: aiSettings.endpoint }))
        });
      }
    } finally {
      setIsTyping(false);
      abortControllerRef.current = null;
    }
  };

  const toggleDeepMode = () => {
    updateAISettings({ ...aiSettings, deepMode: !aiSettings.deepMode });
  };



  const openExternal = async (url: string) => {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch {
      window.open(url, '_blank');
    }
  };

  if (ollamaStatus === 'not_found') {
    return (
      <div className="bg-[#0e0e0e] flex flex-col h-full items-center justify-center p-8 text-center animate-in fade-in duration-500">
        <div className="w-20 h-20 bg-red-500/10 rounded-3xl flex items-center justify-center mb-6 border border-red-500/20 shadow-2xl shadow-red-500/5">
          <Brain size={40} className="text-red-400 opacity-80" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2 tracking-tight">{t('ai.ollama_error.title')}</h2>
        <p className="text-[13px] text-[#555] max-w-[280px] leading-relaxed mb-8">
          {t('ai.ollama_error.desc')}
        </p>
        <button
          onClick={() => openExternal('https://ollama.com')}
          className="flex items-center gap-2 px-6 py-2.5 bg-white text-black text-xs font-bold rounded-xl hover:bg-white/90 active:scale-95 transition-all shadow-lg"
        >
          <Download size={16} />
          {t('ai.ollama_error.download')}
        </button>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 text-[11px] text-[#444] hover:text-white transition-colors underline underline-offset-4"
        >
          {t('ai.status.relaunching')}
        </button>
      </div>
    );
  }

  return (
    <div
      className="bg-[#0e0e0e] flex flex-col h-full overflow-hidden relative"
    >
      {/* Header */}
      <div className="p-3 border-b border-[#1a1a1a] flex items-center justify-between bg-[#0a0a0a] shrink-0">
        <div className="flex items-center gap-2 relative" ref={menuRef}>
          <button
            onClick={() => setShowModelMenu(!showModelMenu)}
            className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-white/5 transition-all group"
          >
            <div className="flex flex-col items-start translate-y-[1px]">
              <span className="text-[11px] font-bold text-white/90 group-hover:text-white transition-colors uppercase tracking-tight leading-none">
                {selectedModel.split(':')[0] || t('ai.no_models')}
              </span>
              {selectedModel && (
                <span className="text-[8px] text-[#555] font-mono leading-tight mt-0.5">
                  {models.find(m => m.name === selectedModel)?.details?.parameter_size || '---'}
                </span>
              )}
            </div>
            <ChevronDown size={12} className={`text-[#444] group-hover:text-white/40 transition-transform ${showModelMenu ? 'rotate-180' : ''}`} />
          </button>

          {showModelMenu && (
            <div className="absolute top-full left-0 mt-2 w-64 bg-[#0a0a09]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
              <div className="p-2 border-b border-white/5 flex items-center justify-between">
                <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest px-2">{t('ai.models.local_title')}</span>
                <span className="text-[9px] text-white/20 px-2">{t('ai.models.found', { count: models.length.toString() })}</span>
              </div>
              <div className="max-h-80 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {models.map(m => (
                  <button
                    key={m.name}
                    onClick={() => { setSelectedModel(m.name); setShowModelMenu(false); }}
                    className={`w-full text-left p-2 rounded-lg transition-all flex items-center justify-between group/item ${
                      selectedModel === m.name ? 'bg-white/10 border-white/10' : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${getModelColor(m.details?.family || '')}`}>
                        {getModelFamilyIcon(m.details?.family || '')}
                      </div>
                      <div className="flex flex-col">
                        <span className={`text-[11px] font-semibold transition-colors ${selectedModel === m.name ? 'text-white' : 'text-white/60 group-hover/item:text-white/90'}`}>
                          {m.name.split(':')[0]}
                        </span>
                        <div className="flex items-center gap-1.5">
                           <span className="text-[8px] text-white/30 font-mono tracking-tighter uppercase">{m.details?.parameter_size || '---'}</span>
                           <span className="text-[8px] text-white/20">•</span>
                           <span className="text-[8px] text-white/30 font-mono tracking-tighter uppercase">{m.details?.quantization_level || '---'}</span>
                        </div>
                      </div>
                    </div>
                    {selectedModel === m.name && (
                      <div className="w-1.5 h-1.5 rounded-full bg-white/40 shadow-sm" />
                    )}
                  </button>
                ))}
                {models.length === 0 && (
                  <div className="p-8 text-center">
                    <div className="text-[10px] text-white/20 italic">{t('ai.no_models')}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowHistory(!showHistory); }}
            className={`text-[#555] hover:text-white p-1 rounded hover:bg-white/10 transition-colors ${showHistory ? "text-white bg-white/10" : ""}`}
            title={t('ai.history_tooltip')}
          >
            <History size={16} />
          </button>
          <button
            onClick={() => createSession()}
            className="text-[#555] hover:text-white p-1 rounded hover:bg-white/10"
            title={t('ai.new_session_tooltip')}
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => setRightPanelOpen(false)}
            className="text-[#555] hover:text-white p-1 rounded hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative flex flex-col">


        {/* History Overlay */}
        {showHistory && (
          <div
            className="absolute inset-0 bg-[#0e0e0e] z-20 border-l border-[#1a1a1a] flex flex-col"
          >
            <div className="p-3 border-b border-[#1a1a1a] flex items-center justify-between">
              <span className="text-xs font-semibold text-[#555] uppercase tracking-wider">{t('ai.history_title')}</span>
              <button onClick={() => setShowHistory(false)}><X size={14} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {chatSessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => { switchSession(s.id); setShowHistory(false); }}
                  className={`p-2 rounded-lg flex items-center justify-between group cursor-pointer transition-colors ${activeSessionId === s.id ? "bg-white/10 border border-white/10" : "hover:bg-white/5"}`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <MessageSquare size={14} className={activeSessionId === s.id ? "text-white" : "text-[#555]"} />
                    <span className={`text-xs truncate ${activeSessionId === s.id ? "text-white" : "text-[#999]"}`}>{s.title}</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin bg-[#0e0e0e]">
          {activeSession?.messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[95%] p-3 rounded-xl text-[13px] leading-relaxed ${msg.role === "user"
                  ? "bg-white text-black rounded-br-none"
                  : msg.role === "tool"
                    ? "bg-[#0a0a0a] text-[#555] border border-[#1a1a1a] font-mono text-[10px] truncate max-w-[80%]"
                    : "bg-[#141414] text-[#ccc] border border-[#1e1e1e] rounded-bl-none prose prose-invert prose-xs max-w-full"
                  }`}
              >
                {msg.role === "ai" ? (
                  <div className="space-y-2">
                    {msg.thinking && (
                        <details className="bg-white/5 rounded-lg border border-white/5 overflow-hidden group">
                           <summary className="px-3 py-2 text-[10px] text-white/40 cursor-pointer hover:bg-white/5 transition-colors font-mono flex items-center gap-2 select-none">
                              <Brain size={12} />
                              {t('ai.thinking_trace')}
                           </summary>
                           <div className="px-3 pb-3 pt-1 text-[11px] text-white/50 italic whitespace-pre-wrap leading-relaxed border-t border-white/5 bg-black/20">
                              {msg.thinking}
                           </div>
                        </details>
                    )}
                    {msg.tool_calls && msg.tool_calls.map((tc, idx) => (
                      <div key={idx} className="flex items-center gap-2 mb-2 p-1.5 bg-white/5 rounded border border-white/10 text-[10px] text-white/50 animate-pulse">
                        <Brain size={12} />
                        <span>{t('ai.tool_running', { tool: tc.function.name })}</span>
                      </div>
                    ))}
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ className, children, ...props }) {
                          return (
                            <code className={`${className} bg-[#0e0e0e] px-1 py-0.5 rounded text-white/80 font-mono text-[12px]`} {...props}>
                              {children}
                            </code>
                          )
                        },
                        pre({ children }) {
                          return <pre className="bg-[#0a0a0a] p-3 rounded-lg border border-[#1e1e1e] my-2 overflow-x-auto">{children}</pre>
                        }
                      }}
                    >
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                ) : msg.role === "tool" ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-white/40">
                      <Save size={12} />
                      <span className="truncate">{t('ai.status.tool_result')} ({msg.tool_id})</span>
                    </div>
                    {msg.text.startsWith('Error') && (
                      <div className="mt-1 text-red-400/70 border-t border-red-900/20 pt-1">
                        {msg.text}
                      </div>
                    )}
                  </div>
                ) : msg.role === "warning" ? (
                  <div className="flex items-center gap-2 text-yellow-500/80 bg-yellow-500/5 px-2 py-1 rounded border border-yellow-500/20">
                    <Brain size={12} className="animate-pulse" />
                    <span className="text-[11px] font-semibold italic">{msg.text}</span>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                )}
              </div>
            </div>
          ))}

          {/* Permission Request */}
          {pendingTool && (
            <div className="flex justify-start">
              <div className="bg-[#1a1a1a] border border-white/20 p-4 rounded-xl max-w-[90%] shadow-2xl animate-in slide-in-from-left-2 transition-all">
                <div className="flex items-center gap-2 mb-3 text-white font-semibold">
                  <Sparkles size={16} className="text-white" />
                  <span className="text-xs uppercase tracking-tighter">{t('ai.tool_permission_title')}</span>
                </div>
                <div className="bg-black/40 p-3 rounded-lg border border-white/5 mb-4">
                  <div className="text-[11px] text-white/90 font-mono mb-1">{pendingTool.name}</div>
                  <pre className="text-[9px] text-white/40 overflow-x-auto max-h-32 scrollbar-none">
                    {JSON.stringify(pendingTool.args, null, 2)}
                  </pre>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      // Capture the id at click time and only clear state if
                      // the dialog is still showing *this* id. A faster
                      // follow-up prompt may have already replaced
                      // `pendingTool`; if we cleared unconditionally we'd
                      // hide the newer dialog and strand its Promise.
                      const clickedId = pendingTool.id;
                      const resolver = pendingResolversRef.current.get(clickedId);
                      if (!resolver) return;
                      pendingResolversRef.current.delete(clickedId);
                      setPendingTool((current) =>
                        current && current.id === clickedId ? null : current
                      );
                      resolver(true);
                    }}
                    className="flex-1 py-2 bg-white text-black text-xs font-bold rounded-lg hover:bg-white/90 active:scale-95 transition-all"
                  >
                    {t('ai.tool_allow')}
                  </button>
                  <button
                    onClick={() => {
                      const clickedId = pendingTool.id;
                      const resolver = pendingResolversRef.current.get(clickedId);
                      if (!resolver) return;
                      pendingResolversRef.current.delete(clickedId);
                      setPendingTool((current) =>
                        current && current.id === clickedId ? null : current
                      );
                      resolver(false);
                    }}
                    className="flex-1 py-2 bg-[#222] text-white text-xs font-bold rounded-lg hover:bg-[#333] active:scale-95 transition-all"
                  >
                    {t('ai.tool_deny')}
                  </button>
                </div>
              </div>
            </div>
          )}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-[#141414] p-3 rounded-xl border border-[#1e1e1e] flex gap-1">
                <div className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce" />
                <div className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:0.2s]" />
                <div className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Context indicator */}
      {(currentFile || projectTree.length > 0) && (
        <div className="px-4 py-1 text-[10px] text-[#444] bg-[#0a0a0a] border-t border-[#1a1a1a] flex items-center justify-between shrink-0 font-mono">
          <div className="flex items-center gap-1.5 ">
            <Code2 size={12} className="text-white/20" />
            <span className="text-white/40">{projectTree.length > 0 ? t('ai.context.workspace') : t('ai.context_indicator')}</span>
          </div>
          {openFiles.length > 1 && (
            <span className="text-white/20">{t('ai.context.open_files', { count: (openFiles.length - 1).toString() })}</span>
          )}
        </div>
      )}

      {/* Mode Switcher */}
      <div className="px-4 py-2 flex gap-1 bg-[#0a0a0a] border-t border-[#1a1a1a]">
        {[
          { id: 'agent', icon: Brain, label: t('ai.mode.agent'), requiresFolder: true },
          { id: 'planner', icon: Sparkles, label: t('ai.mode.planner'), requiresFolder: true },
          { id: 'ask', icon: MessageSquare, label: t('ai.mode.ask'), requiresFolder: false }
        ].map((mode) => {
          const isLocked = mode.requiresFolder && !rootPath;
          return (
            <button
              key={mode.id}
              onClick={() => !isLocked && setChatMode(mode.id as 'agent' | 'planner' | 'ask')}
              disabled={isLocked}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-2 rounded-lg transition-all duration-300 ${
                chatMode === mode.id
                  ? "bg-white/10 text-white shadow-sm border border-white/5"
                  : isLocked
                    ? "text-[#222] cursor-not-allowed opacity-50"
                    : "text-[#444] hover:text-[#777] hover:bg-white/[0.02]"
              }`}
              title={isLocked ? t('agent.skills.no_project') : t(`ai.mode.${mode.id}.desc`)}
            >
              {isLocked ? <Lock size={10} className="text-[#333]" /> : <mode.icon size={12} className={chatMode === mode.id ? "text-blue-400" : ""} />}
              <span className="text-[10px] font-bold uppercase tracking-wider">{mode.label}</span>
            </button>
          );
        })}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-[#0a0a0a] border-t border-[#1a1a1a] shrink-0">
        <div className="relative group">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isTyping}
            placeholder={isTyping ? t('ai.waiting_ollama') : t('ai.input_placeholder')}
            className="w-full bg-[#111] text-white text-[13px] rounded-xl p-3 pb-12 border border-[#222] focus:outline-none focus:border-[#444] resize-none min-h-[100px] transition-all hover:border-[#333]"
          />
          <div className="absolute bottom-3 left-3 flex gap-2">
            <button
              onClick={toggleDeepMode}
              className={`p-2 rounded-md transition-all ${aiSettings.deepMode ? "text-blue-400 bg-blue-500/10" : "text-[#555] hover:bg-white/10"}`}
              title={t('ai.deep_mode_label')}
            >
              <Brain size={18} className={aiSettings.deepMode ? "animate-pulse" : ""} />
            </button>
          </div>
          <button
            onClick={isTyping ? handleStop : handleSend}
            disabled={!isTyping && !input.trim()}
            className={`absolute bottom-3 right-3 p-2 rounded-lg transition-all ${isTyping
              ? "bg-red-500 text-white hover:bg-red-600 animate-pulse"
              : (input.trim() ? "bg-white text-black hover:bg-white/90" : "bg-[#222] text-[#555] opacity-50 cursor-not-allowed")
              }`}
          >
            {isTyping ? <Square size={18} fill="currentColor" /> : <Send size={18} />}
          </button>
        </div>
        <div className="mt-3 text-center">
          <p className="text-[10px] text-white/20 select-none">
            {t('ai.disclaimer')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default AiChatComponent;
