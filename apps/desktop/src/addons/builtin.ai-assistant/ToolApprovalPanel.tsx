

import React, { useEffect, useMemo, useRef, useState } from "react";
import { lazy } from "react";
import { AlertTriangle, FileText, Terminal, Save, Sparkles } from "lucide-react";
import { safeInvoke as invoke } from "@/api/tauri";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { logger } from "@/lib/logger";

// Monaco's DiffEditor pulls ~1.5 MB of language workers the first time it
// mounts. Keep it off the AI-chat boot path via React.lazy — the
// approval panel only shows up after the model decides to call a tool.
const DiffEditor = lazy(async () => {
  const mod = await import("@monaco-editor/react");
  mod.loader.config({ paths: { vs: "/vs" } });
  return { default: mod.DiffEditor };
});

export type ToolArgs = Record<string, string | number | boolean | string[]>;

export interface PendingTool {
  id: string;
  name: string;
  args: ToolArgs;
}

export type ApprovalResult =
  | { allowed: false }
  | { allowed: true; args: ToolArgs };

interface Props {
  tool: PendingTool;
  rootPath: string | null;
  memory: string;
  onResolve: (result: ApprovalResult) => void;
  t: (key: string, replacements?: Record<string, string>) => string;
}

// Shared path resolver. Duplicated from AiChatComponent intentionally so
// this panel stays a self-contained unit — callers don't need to thread
// `resolvePath` through props. Kept deliberately simple: the workspace
// containment guard on the Rust side (#189) is the real safety net.
function resolveAgainstRoot(p: string, rootPath: string | null): string {
  if (!rootPath) return p;
  if (p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p)) return p;
  const separator = rootPath.includes("\\") ? "\\" : "/";
  const cleanRoot = rootPath.endsWith(separator) ? rootPath : rootPath + separator;
  return cleanRoot + p;
}

// Map file extensions to Monaco language ids. We err on the side of
// plaintext rather than guessing — Monaco will still syntax highlight
// reasonable fallbacks for unknown extensions, and a wrong guess is more
// distracting than none.
function languageForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".mts") || lower.endsWith(".cts")) {
    return "typescript";
  }
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return "javascript";
  }
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "markdown";
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "json";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".toml")) return "ini"; // Monaco has no TOML mode; ini is closest
  if (lower.endsWith(".sh") || lower.endsWith(".bash")) return "shell";
  return "plaintext";
}

const DIFF_EDITOR_OPTIONS = {
  readOnly: true,
  renderSideBySide: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  fontSize: 12,
};

// `write_file` preview. Side-by-side DiffEditor with the current file
// content (or empty string if the file doesn't exist) as the original,
// and the proposed new content as the modified side.
function WriteFilePreview({ tool, rootPath, t }: { tool: PendingTool; rootPath: string | null; t: Props["t"] }) {
  const pathArg = String(tool.args.path ?? "");
  const contentArg = String(tool.args.content ?? "");
  const resolvedPath = useMemo(() => resolveAgainstRoot(pathArg, rootPath), [pathArg, rootPath]);

  const [original, setOriginal] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const existing = await invoke("read_file", { path: resolvedPath }, { silent: true });
        if (!cancelled) setOriginal(existing);
      } catch (err) {
        // File not found is the common case for a create, so don't surface
        // it as an error — just show an empty original. Any other failure
        // gets a warning banner so the user isn't left guessing.
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        if (!/not found|notfound|no such file/i.test(message)) {
          logger.warn("[ToolApprovalPanel] read_file failed, showing empty original:", err);
          setLoadError(message);
        }
        setOriginal("");
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [resolvedPath]);

  const language = languageForPath(pathArg);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px] text-white/60 font-mono truncate">
        <FileText size={12} className="shrink-0" />
        <span className="truncate" title={resolvedPath}>{pathArg}</span>
      </div>
      {loadError && (
        <div className="text-[10px] text-yellow-400/70 bg-yellow-500/5 border border-yellow-500/20 px-2 py-1 rounded">
          {t("ai.approval.load_warning")}
        </div>
      )}
      <div className="h-[360px] rounded-lg overflow-hidden border border-white/10 bg-[#1c1c1c]">
        {original === null ? (
          <div className="flex items-center justify-center h-full text-[11px] text-white/30">
            {t("ai.approval.loading_diff")}
          </div>
        ) : (
          <DiffEditor
            height="100%"
            language={language}
            original={original}
            modified={contentArg}
            theme="vs-dark"
            options={DIFF_EDITOR_OPTIONS}
          />
        )}
      </div>
    </div>
  );
}

// `remember` diff. Same DiffEditor, but the "original" is the current
// MEMORY.md contents from AgentContext, and the "modified" is the proposed
// replacement. Markdown language for nicer bullet rendering.
function RememberPreview({ tool, memory, t }: { tool: PendingTool; memory: string; t: Props["t"] }) {
  const newContent = String(tool.args.content ?? "");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px] text-white/60">
        <Save size={12} className="shrink-0" />
        <span>{t("ai.approval.memory_title")}</span>
      </div>
      <div className="h-[360px] rounded-lg overflow-hidden border border-white/10 bg-[#1c1c1c]">
        <DiffEditor
          height="100%"
          language="markdown"
          original={memory}
          modified={newContent}
          theme="vs-dark"
          options={DIFF_EDITOR_OPTIONS}
        />
      </div>
    </div>
  );
}

// `execute_command` editor. Three editable fields (command, args as
// newline-separated lines, cwd). We reconstruct the ToolArgs shape on
// submit so the agent loop receives the user's edits, not the original.
function ExecuteCommandEditor({
  tool,
  rootPath,
  t,
  onDirty,
}: {
  tool: PendingTool;
  rootPath: string | null;
  t: Props["t"];
  onDirty: (args: ToolArgs) => void;
}) {
  const initialCommand = String(tool.args.command ?? "");
  const initialArgs = Array.isArray(tool.args.args)
    ? (tool.args.args as string[]).map(String)
    : [];
  const initialCwd = typeof tool.args.cwd === "string"
    ? tool.args.cwd
    : rootPath ?? "";

  const [command, setCommand] = useState(initialCommand);
  const [argsText, setArgsText] = useState(initialArgs.join("\n"));
  const [cwd, setCwd] = useState(initialCwd);

  // Publish edits up to the parent on every change so the Allow button
  // reads the latest values. Parsing rules for the args textarea: split
  // on newlines, trim each line, drop empties. This mirrors what a shell
  // user would expect ("one argument per line") without surprising them
  // with token-quoting edge cases.
  useEffect(() => {
    const parsedArgs = argsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    onDirty({
      ...tool.args,
      command,
      args: parsedArgs,
      cwd,
    });
    // Intentionally exclude `onDirty` and `tool.args` — parent re-renders
    // would otherwise reset the user's text mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, argsText, cwd]);

  const previewLine = useMemo(() => {
    const parts = [command, argsText.split("\n").map((l) => l.trim()).filter(Boolean).join(" ")].filter(Boolean);
    return parts.join(" ");
  }, [command, argsText]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 bg-yellow-500/5 border border-yellow-500/20 px-3 py-2 rounded-lg text-[11px] text-yellow-200/80">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <span>{t("ai.approval.exec_warning")}</span>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">
          {t("ai.approval.exec_command_label")}
        </span>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-[12px] text-white font-mono focus:outline-none focus:border-white/30"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">
          {t("ai.approval.exec_args_label")}
        </span>
        <textarea
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          rows={Math.min(8, Math.max(3, argsText.split("\n").length + 1))}
          className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-[12px] text-white/90 font-mono resize-y focus:outline-none focus:border-white/30"
          placeholder={t("ai.approval.exec_args_placeholder")}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">
          {t("ai.approval.exec_cwd_label")}
        </span>
        <input
          type="text"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-[12px] text-white/80 font-mono focus:outline-none focus:border-white/30"
        />
      </label>

      <div className="bg-black/60 border border-white/5 rounded-md px-3 py-2 font-mono text-[11px] text-green-300/80 truncate" title={previewLine}>
        $ {previewLine || "—"}
      </div>
    </div>
  );
}

// Read-only tools (list_directory, read_file, web_search,
// get_workspace_structure). These are low-risk, so we keep the compact
// "tool name + JSON args" card from the old dialog — no need for a full
// diff or editor.
function SimpleToolPreview({ tool }: { tool: PendingTool }) {
  return (
    <div className="bg-black/40 p-3 rounded-lg border border-white/5">
      <div className="text-[11px] text-white/90 font-mono mb-1">{tool.name}</div>
      <pre className="text-[10px] text-white/40 overflow-x-auto max-h-32 scrollbar-thin">
        {JSON.stringify(tool.args, null, 2)}
      </pre>
    </div>
  );
}

const TITLE_ID = "tool-approval-title";

// Tool-aware approval panel. Branches the preview render on `tool.name` so
// destructive operations (write_file, execute_command, remember) get rich
// context, while read-only calls keep the existing lightweight card.
//
// Focus-trap + ARIA contract: role=dialog, aria-modal, labelled by a
// heading, Escape resolves as denied.
export const ToolApprovalPanel: React.FC<Props> = ({
  tool,
  rootPath,
  memory,
  onResolve,
  t,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // For execute_command, the editor publishes its latest args here so
  // Allow can pass them to the loop.
  const editedArgsRef = useRef<ToolArgs>(tool.args);
  const handleDirty = (next: ToolArgs) => {
    editedArgsRef.current = next;
  };

  useFocusTrap({
    active: true,
    containerRef,
    onEscape: () => onResolve({ allowed: false }),
  });

  const titleIcon = (() => {
    if (tool.name === "write_file") return <FileText size={16} className="text-white" />;
    if (tool.name === "execute_command") return <Terminal size={16} className="text-yellow-300" />;
    if (tool.name === "remember") return <Save size={16} className="text-white" />;
    return <Sparkles size={16} className="text-white" />;
  })();

  const body = (() => {
    if (tool.name === "write_file") {
      return <WriteFilePreview tool={tool} rootPath={rootPath} t={t} />;
    }
    if (tool.name === "execute_command") {
      return <ExecuteCommandEditor tool={tool} rootPath={rootPath} t={t} onDirty={handleDirty} />;
    }
    if (tool.name === "remember") {
      return <RememberPreview tool={tool} memory={memory} t={t} />;
    }
    return <SimpleToolPreview tool={tool} />;
  })();

  const handleAllow = () => {
    if (tool.name === "execute_command") {
      onResolve({ allowed: true, args: editedArgsRef.current });
    } else {
      onResolve({ allowed: true, args: tool.args });
    }
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
      tabIndex={-1}
      className="bg-[#1a1a1a] border border-white/20 p-4 rounded-xl w-full max-w-[640px] shadow-2xl animate-in slide-in-from-left-2 transition-all focus:outline-none"
    >
      <div className="flex items-center gap-2 mb-3 text-white font-semibold">
        {titleIcon}
        <span id={TITLE_ID} className="text-xs uppercase tracking-tighter">
          {t("ai.tool_permission_title")}
        </span>
        <span className="ml-auto text-[10px] text-white/40 font-mono">{tool.name}</span>
      </div>

      <div className="mb-4">{body}</div>

      <div className="flex gap-2">
        <button
          onClick={handleAllow}
          className="flex-1 py-2 bg-white text-black text-xs font-bold rounded-lg hover:bg-white/90 active:scale-95 transition-all"
        >
          {t("ai.tool_allow")}
        </button>
        <button
          onClick={() => onResolve({ allowed: false })}
          className="flex-1 py-2 bg-[#222] text-white text-xs font-bold rounded-lg hover:bg-[#333] active:scale-95 transition-all"
        >
          {t("ai.tool_deny")}
        </button>
      </div>
    </div>
  );
};

export default ToolApprovalPanel;
