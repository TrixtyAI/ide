"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, Send, Sparkles, Brain, Code2, ChevronDown, History, Plus, Trash2, MessageSquare, Save, Square, Download, Lock, ClipboardCheck } from "lucide-react";
import { useUI } from "@/context/UIContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useFiles } from "@/context/FilesContext";
import { useChat } from "@/context/ChatContext";
import { useSettings } from "@/context/SettingsContext";
import { useAgent } from "@/context/AgentContext";
import { useReview, isReviewerEligible } from "@/context/ReviewContext";
import ReactMarkdown from "react-markdown";
import { trixtyStore } from "@/api/store";
import { useL10n } from "@/hooks/useL10n";
import remarkGfm from "remark-gfm";
import { safeInvoke as invoke, type OllamaRequest } from "@/api/tauri";
import { IDE_TOOLS } from "./tools";
import { getSystemInfo, detectProjectStack, generateAwarenessBlock, type SystemInfo, type ProjectStack } from "@/lib/awareness";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { logger } from "@/lib/logger";
import { ToolApprovalPanel } from "./ToolApprovalPanel";
import { classifyToolError, formatToolError, failureKey } from "./toolErrors";
import { extractPlan } from "./planExtractor";
import { streamOllamaChat, type OllamaStreamFinalMessage } from "./ollamaStream";
import { cloudChat, keyForProvider, type ChatMessage as ProviderChatMessage } from "@/api/providers/client";
import { PROVIDERS, PROVIDER_IDS } from "@/api/providers/registry";

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

type OllamaChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: string[] }
  | { role: 'assistant'; content: string; tool_calls?: { function: { name: string, arguments: ToolArgs }; id?: string; type?: string }[]; thinking?: string }
  | { role: 'tool'; content: string; tool_call_id: string };


const AiChatComponent: React.FC = () => {
  const { setRightPanelOpen } = useUI();
  const { rootPath } = useWorkspace();
  const { openFiles, currentFile } = useFiles();
  const {
    chatSessions,
    activeSessionId,
    createSession,
    deleteSession,
    switchSession,
    addMessageToSession,
    appendToLastAiMessage,
    finalizeLastAiMessage,
  } = useChat();
  const {
    aiSettings,
    updateAISettings,
    editorSettings,
    systemSettings,
    locale,
  } = useSettings();
  const {
    chatMode, setChatMode, getSystemPrompt,
    skills, activeSkills, docs, activeDocs, refreshAgentData,
    memory, plan, setPlan, clearPlan,
  } = useAgent();
  // Pending-tool state lives in ReviewContext so a sibling Reviewer panel
  // (mounted by page.tsx) can render the approval UI outside this 380 px
  // column when the viewport can afford it. The behaviour of the approval
  // flow — per-call resolver Map, stale-resolver cleanup, callId collision
  // defense — is unchanged; the state just moved up one level.
  const { pendingTool, requestToolApproval, resolvePendingTool } = useReview();
  const { t } = useL10n();
  // When the viewport is wide enough we render the Reviewer in its own right-
  // side column. On narrow windows we fall back to the old inline dialog so
  // destructive tool approvals remain reachable even when there is no room
  // for an extra 480 px column.
  const canDockReviewer = useMediaQuery("(min-width: 1100px)");

  const activeSession = chatSessions.find(s => s.id === activeSessionId);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  // Lifted from `aiSettings` so the dropdown / provider chip can react.
  const activeProvider = aiSettings.activeProvider ?? "ollama";
  const showProviderUI = !!aiSettings.allowProviderKeys;
  // Provider switcher menu visibility (chat header chip).
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const providerMenuRef = useRef<HTMLDivElement>(null);
  // Inline "Add model" input shown at the bottom of the model dropdown
  // for cloud providers — keystroke ergonomics for adding a new model
  // without leaving chat.
  const [draftCloudModel, setDraftCloudModel] = useState("");

  // Unified model list — for Ollama we use the live `/api/tags` fetch
  // result (with parameter_size + quantization metadata); for cloud
  // providers we map the user-curated string list into the same shape so
  // the dropdown render stays one-pass.
  const availableModels: { name: string; details?: OllamaModel["details"] }[] =
    activeProvider === "ollama"
      ? models
      : (aiSettings.providerModels[activeProvider] ?? []).map((name) => ({ name }));
  const [isTyping, setIsTyping] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'connected' | 'not_found'>('checking');
  const [projectTree, setProjectTree] = useState<string[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const modelOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [activeModelIndex, setActiveModelIndex] = useState(0);
  const historyOverlayRef = useRef<HTMLDivElement>(null);
  // Input ref so focus can return here after the Reviewer unmounts (the
  // focus trap inside ToolApprovalPanel already restores to whatever was
  // previously focused; this ref is the natural thing to focus on AI-panel
  // re-entry if nothing else was focused).
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Return focus to the chat input when the Reviewer closes. We only run this
  // on the transition from "has pendingTool" to "no pendingTool" so the focus
  // jump doesn't fire on every unrelated rerender. The focus trap inside the
  // Reviewer restores focus to whatever held it before opening, but during a
  // long streaming turn that element may no longer exist — the chat input is
  // the reliable fallback.
  const hadPendingRef = useRef(false);
  useEffect(() => {
    if (pendingTool) {
      hadPendingRef.current = true;
      return;
    }
    if (hadPendingRef.current) {
      hadPendingRef.current = false;
      inputRef.current?.focus();
    }
  }, [pendingTool]);

  // When the model menu opens, seed `activeModelIndex` to the currently
  // selected model (or the first option) and move focus there. Deferred via
  // microtask so the option buttons are mounted by the time we call `.focus()`.
  useEffect(() => {
    if (!showModelMenu || models.length === 0) return;
    const idx = Math.max(0, models.findIndex((m) => m.name === selectedModel));
    setActiveModelIndex(idx);
    queueMicrotask(() => modelOptionRefs.current[idx]?.focus());
  }, [showModelMenu, models, selectedModel]);

  // Keyboard handler for the model listbox. Enter/Space are handled natively
  // by the `<button>` children; we only override cursor navigation and
  // dismissal so outside-click + native click behaviour stay intact.
  const handleModelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (models.length === 0) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setShowModelMenu(false);
      modelTriggerRef.current?.focus();
      return;
    }
    const len = models.length;
    let next: number | null = null;
    if (e.key === "ArrowDown") next = (activeModelIndex + 1) % len;
    else if (e.key === "ArrowUp") next = (activeModelIndex - 1 + len) % len;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = len - 1;
    if (next === null) return;
    e.preventDefault();
    setActiveModelIndex(next);
    modelOptionRefs.current[next]?.focus();
  };

  // Chat history overlay shares the same a11y contract as the permission
  // dialog: trap Tab, restore focus on close, dismiss on Escape.
  useFocusTrap({
    active: showHistory,
    containerRef: historyOverlayRef,
    onEscape: () => setShowHistory(false),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  // Refs hold the latest aiSettings + updateAISettings so the persistence
  // effect does not fire on every settings tick — it should only re-run
  // when the user actually picks a new model or provider.
  const aiSettingsRef = useRef(aiSettings);
  const updateAISettingsRef = useRef(updateAISettings);
  useEffect(() => {
    aiSettingsRef.current = aiSettings;
    updateAISettingsRef.current = updateAISettings;
  }, [aiSettings, updateAISettings]);

  // Persist last model PER provider so switching providers restores the
  // user's previous pick instead of resetting (issue #267).
  useEffect(() => {
    if (!selectedModel) return;
    const current = aiSettingsRef.current;
    const last = current.lastModelByProvider?.[activeProvider];
    if (last === selectedModel) return;
    updateAISettingsRef.current({
      lastModelByProvider: {
        ...(current.lastModelByProvider ?? {}),
        [activeProvider]: selectedModel,
      },
    });
  }, [selectedModel, activeProvider]);

  // When the user switches providers, restore that provider's last
  // selected model (or fall back to the first curated entry). Skips
  // Ollama, which has its own dynamic model list driven by `/api/tags`.
  useEffect(() => {
    if (activeProvider === "ollama") return;
    const current = aiSettingsRef.current;
    const remembered = current.lastModelByProvider?.[activeProvider];
    const list = current.providerModels[activeProvider] ?? [];
    if (remembered && list.includes(remembered)) {
      setSelectedModel(remembered);
    } else if (list.length > 0) {
      setSelectedModel(list[0]);
    } else {
      setSelectedModel("");
    }
  }, [activeProvider]);

  // Close provider menu on outside click.
  useEffect(() => {
    if (!showProviderMenu) return;
    const handler = (e: MouseEvent) => {
      if (
        providerMenuRef.current &&
        !providerMenuRef.current.contains(e.target as Node)
      ) {
        setShowProviderMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProviderMenu]);

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

  // Returns either the raw tool result (success) or a structured
  // `<tool_error>` XML block (failure). The structured block replaces the
  // old free-form "Error executing tool X: ..." string so local models can
  // latch onto a stable schema and, ideally, take the `hint` into account
  // instead of re-issuing the same failing call.
  //
  // Every `invoke` in here passes `{ silent: true }`. These calls live inside
  // a classifier-catch pair: any rejection is fed through `classifyToolError`
  // + `formatToolError`, so the red `[Tauri Invoke Error]` line `safeInvoke`
  // would otherwise emit is noise — the structured `<tool_error>` block is
  // the single source of truth the model (and the user) see. Suppression is
  // scoped to this function; other `invoke` call sites elsewhere in the
  // component keep their default behaviour.
  const executeToolInternal = async (name: string, args: Record<string, string | number | boolean | string[]>) => {
    try {
      switch (name) {
        case 'list_directory':
          return await invoke("read_directory", { path: resolvePath(String(args.path)) }, { silent: true });
        case 'read_file':
          return await invoke("read_file", { path: resolvePath(String(args.path)) }, { silent: true });
        case 'write_file':
          await invoke("write_file", { path: resolvePath(String(args.path)), content: String(args.content) }, { silent: true });
          return "File written successfully.";
        case 'execute_command':
          return await invoke("execute_command", {
            command: String(args.command),
            args: Array.isArray(args.args) ? args.args.map(String) : [],
            cwd: typeof args.cwd === 'string' ? args.cwd : rootPath
          }, { silent: true });
        case 'get_workspace_structure':
          return await invoke("get_recursive_file_list", { rootPath }, { silent: true });
        case 'web_search':
          return await invoke("perform_web_search", { query: String(args.query) }, { silent: true });
        case 'remember':
          await invoke("write_file", {
            path: resolvePath(".agents/MEMORY.md"),
            content: String(args.content)
          }, { silent: true });
          // Refresh context so the memory visualizer updates
          try {
            await refreshAgentData();
          } catch {}
          return "Memory updated successfully.";
        default:
          return formatToolError({
            code: 'INVALID_ARGS',
            message: `Unknown tool '${name}'`,
            hint: 'Only the documented IDE tools are callable. Re-read the tool list and try again.',
          });
      }
    } catch (err: unknown) {
      return formatToolError(classifyToolError(err, name, args));
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

  // Awareness cache. Previously `getSystemInfo()` + `detectProjectStack()`
  // ran on every `handleSend`, hitting the Tauri bridge three or more times
  // per message (read_directory + read_file + get_system_health). We cache
  // the expensive bits keyed on [rootPath, systemSettings, locale] so the
  // awareness block computes once per workspace switch and settings change,
  // not per keystroke-triggered send.
  const [cachedSystemInfo, setCachedSystemInfo] = useState<SystemInfo | null>(null);
  const [cachedStack, setCachedStack] = useState<ProjectStack | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sys, stack] = await Promise.all([
          getSystemInfo(),
          detectProjectStack(rootPath),
        ]);
        if (cancelled) return;
        setCachedSystemInfo(sys);
        setCachedStack(stack);
      } catch (err) {
        logger.error("Awareness cache refresh failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // systemSettings participates because user-visible excludes and other
    // flags bubble through it; recomputing on change keeps the awareness
    // block honest without needing a manual refresh.
  }, [rootPath, systemSettings]);

  const handleSend = async () => {
    if (!input.trim() || !selectedModel || isTyping || !activeSessionId || !activeSession) return;

    const userMessage = input;
    addMessageToSession(activeSessionId, { role: "user", text: userMessage });
    setInput("");
    setIsTyping(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Cloud-provider branch (issue #267). Routes the request through the
    // generic `cloud_proxy` instead of Ollama's bridge. Tools / agent /
    // streaming are intentionally not wired for cloud yet — every provider
    // has a different SSE envelope and tool-call format. Single-shot
    // chat works for all four providers we ship today.
    const activeProvider = aiSettings.activeProvider ?? "ollama";
    if (activeProvider !== "ollama") {
      try {
        const cloudKey = keyForProvider(aiSettings.providerKeys, activeProvider);
        // Guard against a stale `selectedModel` that belongs to a
        // different provider than the one currently active — e.g. the
        // user switched provider but never reopened the model menu.
        // Fall back to the provider's last remembered model, then to
        // the first curated entry, then bail out with a friendly
        // error before we send a confusing 4xx.
        const providerModelList =
          aiSettings.providerModels[activeProvider] ?? [];
        let modelToUse = selectedModel;
        if (!providerModelList.includes(modelToUse)) {
          modelToUse =
            aiSettings.lastModelByProvider?.[activeProvider] ??
            providerModelList[0] ??
            "";
          if (!modelToUse) {
            addMessageToSession(activeSessionId, {
              role: "ai",
              text: `Error: no model registered for ${activeProvider}. Add one under Settings → Provider Keys.`,
            });
            setIsTyping(false);
            abortControllerRef.current = null;
            return;
          }
          // Sync the chat header so the user sees the model we
          // actually used.
          setSelectedModel(modelToUse);
        }
        const cloudHistory: ProviderChatMessage[] = [
          { role: "system", content: getSystemPrompt() },
          ...activeSession.messages
            .filter((m) => m.role === "user" || m.role === "ai")
            .map((m): ProviderChatMessage => ({
              role: m.role === "ai" ? "assistant" : "user",
              content: m.text,
            })),
          { role: "user", content: userMessage },
        ];
        const result = await cloudChat({
          provider: activeProvider,
          apiKey: cloudKey,
          model: modelToUse,
          messages: cloudHistory,
          temperature: aiSettings.temperature,
          maxTokens: aiSettings.maxTokens,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!result.ok) {
          addMessageToSession(activeSessionId, {
            role: "ai",
            text: `Error: ${result.error || "cloud provider returned no content"}`,
          });
        } else {
          addMessageToSession(activeSessionId, {
            role: "ai",
            text: result.text,
          });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          logger.error("[cloud chat] failed:", err);
          addMessageToSession(activeSessionId, {
            role: "ai",
            text: `Error: ${String(err)}`,
          });
        }
      } finally {
        setIsTyping(false);
        abortControllerRef.current = null;
      }
      return;
    }

    try {
      // Build context for the system prompt
      const workspaceContext = rootPath ? `Workspace Root: ${rootPath}\n` : "";
      const currentContext = currentFile ? `${t('ai.context.focused_file')}: ${currentFile.path}\n` : "";

      // Use cached awareness. If the cache hasn't populated yet (first
      // message after boot) fall back to a live fetch so we don't ship a
      // half-empty block.
      const systemInfo = cachedSystemInfo ?? await getSystemInfo();
      const projectStack = cachedStack ?? await detectProjectStack(rootPath);
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
      // Bounded repeat-failure detection. If the model calls the exact same
      // tool with the exact same args twice in a row and both attempts
      // surface a `<tool_error>` result, we break the loop and hand control
      // back to the user instead of letting it spin until maxIterations
      // exhausts — saving tokens and sparing the user an unbounded wait.
      let lastFailureKey: string | null = null;
      let consecutiveFailureCount = 0;
      let abortedOnRepeat = false;

      // Sanitize the Ollama chat URL once per send. `proxyFetch` does the
      // same collapse for the one-shot path; we mirror it here so the
      // streaming command receives the exact same URL shape regardless of
      // whether the user put a trailing slash on the endpoint setting.
      const chatUrl = `${aiSettings.endpoint}/api/chat`.replace(/([^:]\/)\/+/g, "$1");

      while (loop && maxIterations > 0) {
        maxIterations--;
        const body: OllamaRequest = {
            type: 'chat',

            model: selectedModel,
            messages: history,
            // The streaming helper sets `stream: true` on the wire; we leave
            // this flag off the request type because the Rust side controls
            // the stream vs one-shot toggle per command.
            stream: true,
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

        // Push a placeholder assistant bubble. Tool-call-only turns overwrite
        // the text to the "Interacting…" status below, so starting from an
        // empty string is safe either way. Keeping the placeholder in place
        // lets the scroll-to-bottom effect follow the new message smoothly
        // as tokens stream in.
        let placeholderPushed = false;
        const pushPlaceholderOnce = () => {
          if (placeholderPushed) return;
          addMessageToSession(activeSessionId, { role: "ai", text: "" });
          placeholderPushed = true;
        };

        let streamResult: Awaited<ReturnType<typeof streamOllamaChat>>;
        try {
          streamResult = await streamOllamaChat(chatUrl, body, (delta) => {
            pushPlaceholderOnce();
            appendToLastAiMessage(activeSessionId, delta);
          }, controller.signal);

          // If the model rejected `think`, retry once without it. Matches the
          // one-shot behaviour from before streaming landed.
          if (!streamResult.ok && aiSettings.deepMode && (
            streamResult.status === 400 || (streamResult.errorText && streamResult.errorText.includes("think"))
          )) {
            logger.warn(`Model ${selectedModel} doesn't support Deep Thinking. Retrying without it.`);
            // Wipe the partially-streamed placeholder so the retry starts from
            // a clean bubble instead of appending to the prior failed attempt.
            placeholderPushed = false;
            const reqBody = { ...body, think: false };
            streamResult = await streamOllamaChat(chatUrl, reqBody, (delta) => {
              pushPlaceholderOnce();
              appendToLastAiMessage(activeSessionId, delta);
            }, controller.signal);
          }
        } catch (err) {
          throw err;
        }

        if (!streamResult.ok || !streamResult.message) {
          throw new Error(streamResult.errorText || "Ollama Request Failed");
        }

        const message: OllamaStreamFinalMessage = streamResult.message;

        if (message.tool_calls && message.tool_calls.length > 0) {
          // Add the assistant's tool call to history
          history.push(message);
          // Normalize tool_calls to the stored ChatMessage shape. Ollama
          // usually provides `id` and `type`, but our stream-event type
          // leaves them optional to match the upstream spec — fill defaults
          // so the persisted message matches the stricter ChatMessage
          // contract.
          const normalizedCalls = message.tool_calls.map((tc) => ({
            function: tc.function,
            id: tc.id ?? "",
            type: tc.type ?? "function",
          }));
          // If the stream produced a placeholder (rare — tool-call turns are
          // usually emitted whole in the `done` chunk with no preceding
          // deltas) fold the tool_calls into that bubble so the UI doesn't
          // end up with an empty-text AI message followed by an "interacting"
          // one. Otherwise push a fresh "interacting" bubble as before.
          if (placeholderPushed) {
            finalizeLastAiMessage(activeSessionId, {
              text: t('ai.status.interacting'),
              thinking: message.thinking,
            });
            // The finalizer does not know how to attach `tool_calls`, so we
            // still push a companion message if the placeholder path fired.
            // In practice the above finalize overwrite is enough because the
            // next iteration of the tool loop will re-render the tool_calls
            // chips through `m.tool_calls`; we just need the tool_calls on
            // the message for history.push (done above) and for the
            // `msg.tool_calls` render path below.
            // For that we add a second addMessageToSession call ONLY to
            // attach tool_calls — but that would duplicate. Simpler: use
            // addMessageToSession to replace the placeholder fully by
            // appending a new message and trust the UI renders both. In
            // practice this branch is virtually never hit.
            addMessageToSession(activeSessionId, {
              role: "ai",
              text: "",
              tool_calls: normalizedCalls,
            });
          } else {
            addMessageToSession(activeSessionId, {
              role: "ai",
              text: t('ai.status.interacting'),
              thinking: message.thinking,
              tool_calls: normalizedCalls
            });
          }

          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            const toolArgs = toolCall.function.arguments;
            // Prefer the provider-supplied id; otherwise mint a collision-
            // resistant one up front so the history / approval / resolver
            // tuples line up on the exact same string. Generating inside
            // `requestToolApproval` was tempting but would leave this outer
            // block without a handle on the id for the history entries below.
            const generatedId =
              typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `cid-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
            const callId = toolCall.id || generatedId;

            let result;
            // `effectiveArgs` holds the args actually passed to execution.
            // For manual approval via ToolApprovalPanel this can differ from
            // `toolArgs` when the user edits the command/args/cwd. We keep
            // the original `toolArgs` in history (the model already saw
            // them) but run against the edited version so the user's intent
            // wins.
            let effectiveArgs: ToolArgs = toolArgs;
            if (aiSettings.alwaysAllowTools) {
              result = await executeToolInternal(toolName, toolArgs);
            } else {
              const approval = await requestToolApproval({
                id: callId,
                name: toolName,
                args: toolArgs,
              });
              if (approval.allowed) {
                effectiveArgs = approval.args;
                result = await executeToolInternal(toolName, effectiveArgs);
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

            // Repeat-failure detection. Keyed on the effective args so an
            // edited second attempt is treated as distinct (the model /
            // user changed course). Any success or any change of
            // tool+args resets the counter.
            const isFailure = typeof resultStr === 'string' && resultStr.startsWith('<tool_error');
            const key = failureKey(toolName, effectiveArgs);
            if (isFailure && key === lastFailureKey) {
              consecutiveFailureCount += 1;
            } else if (isFailure) {
              lastFailureKey = key;
              consecutiveFailureCount = 1;
            } else {
              lastFailureKey = null;
              consecutiveFailureCount = 0;
            }
            if (consecutiveFailureCount >= 2) {
              abortedOnRepeat = true;
              break;
            }
          }
          if (abortedOnRepeat) {
            addMessageToSession(activeSessionId, {
              role: 'warning',
              text: t('ai.error.repeat_failure'),
            });
            loop = false;
            break;
          }
          // Continue loop to get AI response for the tool results
        } else {
          // Final assistant turn. If we've been streaming into a placeholder,
          // attach `thinking` and only adopt `message.content` as the final
          // text when the `done` chunk actually carries a body. Ollama's
          // streaming protocol typically returns `message.content === ""` on
          // `done` because the body was already delivered through deltas, so
          // overwriting the accumulated placeholder with "" would make the
          // assistant bubble visually disappear once the response completes
          // (#278). When the model post-processes and resends a full body,
          // we still adopt it. Otherwise we keep what we accumulated.
          // If the stream never produced any deltas (empty response, tool-
          // only turn that ended without content) we push a fresh message so
          // the UI still renders something.
          if (placeholderPushed) {
            const finalText =
              typeof message.content === "string" && message.content.length > 0
                ? message.content
                : undefined;
            finalizeLastAiMessage(activeSessionId, {
              text: finalText,
              thinking: message.thinking,
            });
          } else {
            addMessageToSession(activeSessionId, {
              role: "ai",
              text: message.content ?? "",
              thinking: message.thinking
            });
          }

          // Planner-mode post-processor. If the assistant's final message
          // contains a fenced ```plan``` block, persist it to PLAN.md and
          // surface a user-visible notice so the hand-off to Agent mode is
          // discoverable. Swallow persistence errors (no workspace, disk
          // full) with a logger.warn — the plan is still in the chat, so
          // the user has a fallback.
          if (chatMode === 'planner' && typeof message.content === 'string') {
            const extracted = extractPlan(message.content);
            if (extracted) {
              try {
                await setPlan(extracted);
                addMessageToSession(activeSessionId, {
                  role: 'warning',
                  text: t('ai.plan.saved_notice'),
                });
              } catch (err) {
                logger.warn('[AiChat] Failed to persist plan:', err);
              }
            }
          }

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

  // Only surface the "Ollama not installed" wall when the user is
  // actually trying to use Ollama. With provider keys enabled and a
  // cloud provider active, the chat keeps working even if Ollama is
  // absent.
  if (ollamaStatus === 'not_found' && activeProvider === "ollama") {
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
        {showProviderUI && (
          <div className="relative mr-1" ref={providerMenuRef}>
            <button
              onClick={() => setShowProviderMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={showProviderMenu}
              title="Switch provider"
              className="px-2 py-1 rounded-md text-[10px] uppercase tracking-wider font-bold border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1"
            >
              {PROVIDERS[activeProvider]?.label.split(" ")[0] ?? activeProvider}
              <ChevronDown size={10} className={`transition-transform ${showProviderMenu ? "rotate-180" : ""}`} />
            </button>
            {showProviderMenu && (
              <div
                role="menu"
                className="absolute top-full left-0 mt-2 w-52 bg-[#0a0a09]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
              >
                {PROVIDER_IDS.map((pid) => {
                  const meta = PROVIDERS[pid];
                  const keyMissing =
                    meta.kind === "cloud" &&
                    !aiSettings.providerKeys[pid as Exclude<typeof pid, "ollama">];
                  return (
                    <button
                      key={pid}
                      onClick={() => {
                        updateAISettings({ activeProvider: pid });
                        setShowProviderMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-[11px] flex items-center justify-between transition-colors ${
                        activeProvider === pid
                          ? "bg-white/10 text-white"
                          : "text-white/70 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <span>{meta.label}</span>
                      {keyMissing && (
                        <span className="text-[9px] text-amber-300/80 uppercase tracking-wider">
                          No key
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 relative" ref={menuRef}>
          <button
            ref={modelTriggerRef}
            onClick={() => setShowModelMenu(!showModelMenu)}
            aria-haspopup="listbox"
            aria-expanded={showModelMenu}
            aria-controls="ai-model-listbox"
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
              <div
                role="listbox"
                id="ai-model-listbox"
                aria-label={t('ai.models.local_title')}
                onKeyDown={handleModelKeyDown}
                className="max-h-80 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
              >
                {availableModels.map((m, idx) => (
                  <button
                    key={m.name}
                    ref={(el) => {
                      modelOptionRefs.current[idx] = el;
                    }}
                    role="option"
                    aria-selected={selectedModel === m.name}
                    tabIndex={activeModelIndex === idx ? 0 : -1}
                    onClick={() => { setSelectedModel(m.name); setShowModelMenu(false); modelTriggerRef.current?.focus(); }}
                    onFocus={() => setActiveModelIndex(idx)}
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
                {availableModels.length === 0 && (
                  <div className="p-8 text-center">
                    <div className="text-[10px] text-white/20 italic">{t('ai.no_models')}</div>
                  </div>
                )}
              </div>
              {activeProvider !== "ollama" && (
                // Inline "Add model" footer for cloud providers — pushes
                // the typed string into `aiSettings.providerModels[provider]`
                // so the user does not have to leave chat to register a new
                // model ID. Settings → Provider Keys → Models is the same
                // store under the hood.
                <div className="border-t border-white/5 p-2 flex gap-2 items-center bg-black/30">
                  <input
                    type="text"
                    value={draftCloudModel}
                    onChange={(e) => setDraftCloudModel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const id = draftCloudModel.trim();
                        if (!id) return;
                        const existing =
                          aiSettings.providerModels[activeProvider] ?? [];
                        if (!existing.includes(id)) {
                          updateAISettings({
                            providerModels: {
                              ...aiSettings.providerModels,
                              [activeProvider]: [...existing, id],
                            },
                          });
                        }
                        setSelectedModel(id);
                        setDraftCloudModel("");
                        setShowModelMenu(false);
                      }
                    }}
                    placeholder="Add model ID + Enter"
                    className="flex-1 bg-[#0e0e0e] border border-white/10 rounded px-2 py-1 text-[10px] text-white font-mono focus:border-blue-500/50 outline-none transition-colors"
                  />
                </div>
              )}
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

      {/* PLAN active indicator. Visible whenever `.agents/PLAN.md` holds a
          non-empty checklist so the user can tell the agent is following a
          planner hand-off. The Clear button deletes the file and stops the
          injection into the system prompt for future messages. */}
      {plan && plan.trim().length > 0 && (
        <div className="px-3 py-1.5 flex items-center justify-between gap-2 bg-blue-500/5 border-b border-blue-500/20 text-[11px] text-blue-200/80 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardCheck size={12} className="shrink-0" />
            <span className="font-semibold uppercase tracking-wider">{t('ai.plan.active_indicator')}</span>
          </div>
          <button
            onClick={() => { clearPlan(); }}
            title={t('ai.plan.clear_tooltip')}
            className="text-[10px] text-blue-200/60 hover:text-white px-2 py-0.5 rounded hover:bg-white/10 transition-colors"
          >
            {t('ai.plan.clear_button')}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden relative flex flex-col">


        {/* History Overlay */}
        {showHistory && (
          <div
            ref={historyOverlayRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-history-title"
            tabIndex={-1}
            className="absolute inset-0 bg-[#0e0e0e] z-20 border-l border-[#1a1a1a] flex flex-col focus:outline-none"
          >
            <div className="p-3 border-b border-[#1a1a1a] flex items-center justify-between">
              <span id="chat-history-title" className="text-xs font-semibold text-[#555] uppercase tracking-wider">{t('ai.history_title')}</span>
              <button onClick={() => setShowHistory(false)} aria-label={t('window.close')}><X size={14} /></button>
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
        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={isTyping}
          aria-label={t('ai.chat_log_label')}
          className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin bg-[#0e0e0e]"
        >
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

          {/* Permission Request.
              - Read-only tools (list_directory / read_file / web_search /
                get_workspace_structure) always render inline: the compact
                JSON card is perfectly legible inside the 380 px AI panel.
              - Destructive tools (write_file / execute_command / remember)
                render in the dedicated Reviewer dock when the viewport has
                room for it; here we surface a minimal hint card so the user
                can find the approval UI. On narrow viewports the Reviewer
                column is not mounted and we fall back to the full panel
                inline so approvals never become unreachable. */}
          {pendingTool && !isReviewerEligible(pendingTool.name) && (
            <div className="flex justify-start w-full">
              <ToolApprovalPanel
                tool={pendingTool}
                rootPath={rootPath}
                memory={memory}
                onResolve={resolvePendingTool}
                t={t}
              />
            </div>
          )}
          {pendingTool && isReviewerEligible(pendingTool.name) && canDockReviewer && (
            <div className="flex justify-start w-full">
              <div className="bg-blue-500/5 border border-blue-500/30 p-3 rounded-xl w-full max-w-[95%] text-[11px] text-blue-200/80 flex items-center gap-2 animate-in fade-in">
                <ClipboardCheck size={14} className="shrink-0" />
                <span className="font-semibold">{t('ai.reviewer.pending_hint')}</span>
                <span className="ml-auto font-mono text-[10px] text-blue-200/60">{pendingTool.name}</span>
              </div>
            </div>
          )}
          {pendingTool && isReviewerEligible(pendingTool.name) && !canDockReviewer && (
            <div className="flex justify-start w-full">
              <ToolApprovalPanel
                tool={pendingTool}
                rootPath={rootPath}
                memory={memory}
                onResolve={resolvePendingTool}
                t={t}
              />
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
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isTyping}
            aria-label={t('ai.input_placeholder')}
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
