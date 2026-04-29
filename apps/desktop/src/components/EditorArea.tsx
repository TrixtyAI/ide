"use client";

import React, { Suspense, useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import type { OnMount, Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useFiles } from "@/context/FilesContext";
import { useSettings } from "@/context/SettingsContext";
import TabBar, { EDITOR_TABPANEL_ID, tabIdFor } from "./TabBar";
import { useL10n } from "@/hooks/useL10n";
import { useInlineCompletions } from "@/hooks/useInlineCompletions";
import { ErrorBoundary } from "./ErrorBoundary";
import { Code2, LayoutGrid } from "lucide-react";
import { getVisualEditor } from "./visual/getVisualEditor";
import * as Sentry from "@sentry/nextjs";

// Monaco is ~1.5 MB of gzipped JS and pulls language workers on top of that.
// Loading it with `next/dynamic` keeps it off the boot path; it only arrives
// once the user opens their first real file. The loader also needs `window`,
// so keep `ssr: false`.
const MonacoEditor = dynamic(
  async () => {
    const mod = await import("@monaco-editor/react");
    mod.loader.config({ paths: { vs: "/vs" } });
    return mod.default;
  },
  { ssr: false },
);

// Marketplace is only reachable via the virtual `extensions` tab — no reason
// to ship it in the initial bundle next to Monaco.
const MarketplaceView = dynamic(() => import("./MarketplaceView"), { ssr: false });

// Bracket colorization and indent guides are expensive on very large buffers.
// Above this threshold we disable both. Kept as a module constant so the memo
// dep (`isLargeFile` boolean) only flips when crossing the threshold, not on
// every keystroke inside the file.
const LARGE_FILE_BYTES = 1024 * 1024;
const MONACO_THEME_NAME = "trixty-dark";

// Theme config is static, so hoist the literal out of `handleEditorDidMount`
// and register it at most once per page load. Each tab switch would otherwise
// re-run `defineTheme` against the same name.
const TRIXTY_DARK_THEME: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "5c6370", fontStyle: "italic" },
    { token: "keyword", foreground: "c678dd" },
    { token: "keyword.control", foreground: "c678dd" },
    { token: "keyword.operator", foreground: "c678dd" },
    { token: "keyword.function", foreground: "c678dd" },
    { token: "storage", foreground: "c678dd" },
    { token: "storage.type", foreground: "c678dd" },
    { token: "storage.modifier", foreground: "c678dd" },
    { token: "variable.parameter", foreground: "61afef" },
    { token: "variable.name", foreground: "abb2bf" },
    { token: "variable.other.property", foreground: "61afef" },
    { token: "identifier", foreground: "abb2bf" },
    { token: "type", foreground: "e5c07b" },
    { token: "class", foreground: "e5c07b" },
    { token: "function", foreground: "61afef" },
    { token: "string", foreground: "98c379" },
    { token: "number", foreground: "d19a66" },
    { token: "constant", foreground: "d19a66" },
    { token: "operator", foreground: "c678dd" },
    { token: "delimiter", foreground: "abb2bf" },
    { token: "delimiter.bracket", foreground: "c678dd" },
    { token: "tag", foreground: "e06c75" },
    { token: "attribute.name", foreground: "d19a66" },
    { token: "attribute.value", foreground: "98c379" },
    { token: "meta.preprocessor", foreground: "c678dd" },
    { token: "key", foreground: "61afef" },
  ],
  colors: {
    "editor.background": "#1c1c1c",
    "editor.foreground": "#abb2bf",
    "editorLineNumber.foreground": "#4b5263",
    "editorLineNumber.activeForeground": "#abb2bf",
    "editor.lineHighlightBackground": "#2c313a",
    "editorCursor.foreground": "#528bff",
    "editor.selectionBackground": "#3e445190",
    "editor.inactiveSelectionBackground": "#3e445140",
    "editorBracketMatch.background": "#515a6b",
    "editorBracketMatch.border": "#515a6b",
    "editorOverviewRuler.border": "#00000000",
    "editor.border": "#181a1f",
    "editorIndentGuide.background": "#3b4048",
    "editorIndentGuide.activeBackground": "#c678dd",
    "editorSuggestWidget.background": "#1c1c1c",
    "editorSuggestWidget.border": "#181a1f",
    "editorSuggestWidget.selectedBackground": "#2c313a",
    "editorWidget.background": "#1c1c1c",
    "editorWidget.border": "#181a1f",
  },
};

let monacoThemeRegistered = false;
function ensureMonacoTheme(monaco: Monaco) {
  if (monacoThemeRegistered) return;
  monaco.editor.defineTheme(MONACO_THEME_NAME, TRIXTY_DARK_THEME);
  monacoThemeRegistered = true;
}

// Local `prefers-reduced-motion` hook. Kept in this file for now since #214 is
// the only consumer; can be promoted to a shared hook if #194 lands and other
// components need it.
function usePrefersReducedMotion(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === "undefined") return () => {};
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  const getSnapshot = useCallback(
    () =>
      typeof window === "undefined"
        ? false
        : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

const EditorArea: React.FC = () => {
  const { currentFile, updateFileContent, openFiles } = useFiles();
  const { editorSettings } = useSettings();
  const { t } = useL10n();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  // State copy of the Monaco instance so the inline-completions hook
  // re-runs once Monaco loads. Refs alone don't trigger re-renders.
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  // Wires the AI inline-completions provider once Monaco is ready. Off by
  // default — flipped via `aiSettings.inlineCompletions.enabled`.
  useInlineCompletions(monacoInstance);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setMonacoInstance(monaco);

    ensureMonacoTheme(monaco);
    monaco.editor.setTheme(MONACO_THEME_NAME);

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      reactNamespace: "React",
      allowJs: true,
      typeRoots: ["node_modules/@types"],
    });

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });

    editor.focus();
  };

  // Performance: Efficient Layout handling
  React.useEffect(() => {
    if (!containerRef.current || !editorRef.current) return;

    // Immediate layout
    editorRef.current.layout();

    const resizeObserver = new ResizeObserver(() => {
      editorRef.current?.layout();
    });

    resizeObserver.observe(containerRef.current);

    // Delayed layout to catch cases where the container might still be expanding
    const timer = setTimeout(() => {
      editorRef.current?.layout();
    }, 50);

    return () => {
      resizeObserver.disconnect();
      clearTimeout(timer);
    };
  }, [openFiles.length, currentFile?.path]);

  // Memory: Clean up Monaco models when files are closed.
  const openPathKeys = openFiles.map(f => f.path).join("\n");
  React.useEffect(() => {
    if (!monacoRef.current || !currentFile) return;

    const normalize = (p: string) => {
      const slashed = p.replace(/\\/g, "/");
      const isWindowsPath = /^[A-Za-z]:\//.test(slashed) || slashed.startsWith("//");
      const result = isWindowsPath ? slashed.toLowerCase() : slashed;
      return result;
    };

    const openPathsArray = openFiles.map(f => normalize(f.path));
    const openPaths = new Set(openPathsArray);
    const activeModelPath = normalize(currentFile.path);

    const models = monacoRef.current.editor.getModels();
    for (const model of models) {
      if (model.uri.scheme === "inmemory") continue;

      const modelPath = normalize(model.uri.fsPath);

      // Safety: Never dispose of the current file's model
      if (modelPath === activeModelPath) continue;

      if (!openPaths.has(modelPath)) {
        model.dispose();
      }
    }
    // Sentry Tracking for File Open
    Sentry.metrics.count('editor_file_open', 1, {
      attributes: { 
        language: currentFile.language || 'unknown',
        extension: currentFile.path.split('.').pop() || 'none',
        type: currentFile.type || 'text'
      }
    });
    
    if (isLargeFile) {
      Sentry.metrics.count('editor_large_file_open', 1);
      Sentry.logger.info(`Large file opened: ${currentFile.path}`, { 
        size: currentFile.content?.length,
        path: currentFile.path 
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPathKeys, currentFile?.path]);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // If the EditorArea unmounts while a debounced write is still pending
  // (closing the last tab, switching workspace, hot reload), the callback
  // would otherwise fire and call `updateFileContent` on a context that
  // may already be tearing down. Clear the timer on unmount so the
  // pending write is dropped cleanly.
  React.useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, []);

  const handleEditorChange = (value: string | undefined) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    // Capture the path and content at the moment the edit happened. If the timer
    // fires after the user has switched tabs, it must still write into the file
    // that was being edited — not into whatever is currently active.
    const path = currentFile?.path;
    if (!path) return;
    const content = value ?? "";
    debounceTimer.current = setTimeout(() => {
      updateFileContent(path, content);
    }, 300);
  };

  // Derive the threshold as a primitive boolean so the memo below only rebuilds
  // options when we cross `LARGE_FILE_BYTES`, not on every keystroke.
  const isLargeFile = (currentFile?.content?.length ?? 0) >= LARGE_FILE_BYTES;

  const editorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      minimap: { enabled: editorSettings.minimapEnabled },
      fontSize: editorSettings.fontSize,
      fontFamily: editorSettings.fontFamily,
      fontLigatures: true,
      lineHeight: editorSettings.lineHeight,
      letterSpacing: 0.5,
      largeFileOptimizations: true,
      maxTokenizationLineLength: 20000,
      scrollbar: {
        vertical: "visible",
        horizontal: "visible",
        useShadows: false,
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
      lineNumbers: "on",
      roundedSelection: true,
      scrollBeyondLastLine: false,
      readOnly: false,
      automaticLayout: true,
      padding: { top: 15 },
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      renderLineHighlight: "all",
      fixedOverflowWidgets: true,
      bracketPairColorization: { enabled: !isLargeFile },
      guides: { bracketPairs: !isLargeFile },
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: "on",
      quickSuggestions: true,
      tabCompletion: "on",
      wordBasedSuggestions: "currentDocument",
      parameterHints: { enabled: true },
      suggest: { showIcons: true },
      links: false,
      unicodeHighlight: {
        ambiguousCharacters: false,
        invisibleCharacters: false,
      },
      cursorSmoothCaretAnimation: prefersReducedMotion ? "off" : "on",
      // Accessibility: `accessibilitySupport: "on"` force-enables the hidden
      // DOM mirror Monaco ships for screen readers (default is "auto", which
      // disables it unless Monaco detects AT — unreliable inside a Tauri
      // webview). `ariaLabel` is what AT announces when focus lands on the
      // editor; using the path keeps two tabs with the same basename
      // distinguishable.
      accessibilitySupport: "on",
      ariaLabel: currentFile?.path,
    }),
    [
      editorSettings.minimapEnabled,
      editorSettings.fontSize,
      editorSettings.fontFamily,
      editorSettings.lineHeight,
      isLargeFile,
      prefersReducedMotion,
      currentFile?.path,
    ],
  );

  if (openFiles.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0e0e0e] text-[#333]">
        <div className="text-4xl opacity-10 mb-4 font-bold select-none italic tracking-tight">{t('welcome.title')}</div>
        <p className="text-[11px] opacity-40">{t('editor.empty_desc')}</p>
      </div>
    );
  }

  // Check if current tab is a virtual tab
  const isVirtualTab = currentFile?.type === "virtual";
  const isBinaryTab = currentFile?.type === "binary";

  // Render virtual views
  const renderVirtualView = () => {
    switch (currentFile?.path) {
      case "virtual://extensions":
        return (
          <ErrorBoundary name="Marketplace">
            <MarketplaceView />
          </ErrorBoundary>
        );
      default:
        return (
          <div className="flex-1 flex items-center justify-center text-[#606060] text-sm">
            {t('editor.view_not_found')}
          </div>
        );
    }
  };
  const activeTabId = currentFile ? tabIdFor(currentFile.path) : undefined;

  return (
    <div className="flex-1 w-full h-full overflow-hidden flex flex-col bg-[#0e0e0e]">
      <TabBar />

      <div
        role="tabpanel"
        id={EDITOR_TABPANEL_ID}
        aria-labelledby={activeTabId}
        tabIndex={0}
        className="flex-1 overflow-hidden relative focus:outline-none"
        ref={containerRef}
      >
        {isVirtualTab ? (
          renderVirtualView()
        ) : isBinaryTab ? (
          <div className="flex-1 h-full flex items-center justify-center p-8">
            <p className="text-[13px] text-[#888] max-w-md text-center leading-relaxed">
              {t('editor.bin_file')}
            </p>
          </div>
        ) : currentFile ? (
          <FileViewSurface
            file={currentFile}
            onContentChange={(next) => updateFileContent(currentFile.path, next)}
            monacoElement={
              <div className="h-full" data-allow-global-shortcuts="true">
                <MonacoEditor
                  height="100%"
                  language={currentFile.language}
                  value={currentFile.content}
                  theme={MONACO_THEME_NAME}
                  onMount={handleEditorDidMount}
                  onChange={handleEditorChange}
                  path={currentFile.path}
                  options={editorOptions}
                />
              </div>
            }
          />
        ) : null}
      </div>
    </div>
  );
};

export default EditorArea;

interface FileViewSurfaceProps {
  file: import("@/context/FilesContext").FileState;
  onContentChange: (next: string) => void;
  monacoElement: React.ReactNode;
}

/**
 * Wraps Monaco with a sub-tab strip ("Source" / visual label) when the
 * current file has a registered visual editor (issue #264). For files
 * without a visual surface, renders Monaco directly with no strip — keeps
 * the default editor experience untouched.
 *
 * View mode is a tiny `Map<path, mode>` so switching tabs preserves the
 * user's last choice per file. Default mode is "source" so a brand-new
 * package.json / .env / .json file opens in the same place every other
 * file does.
 */
const FileViewSurface: React.FC<FileViewSurfaceProps> = ({
  file,
  onContentChange,
  monacoElement,
}) => {
  const visuals = useMemo(() => getVisualEditor(file), [file]);
  // Mode tracks "source" or one of the visual entry ids. Per-path so
  // switching files of the same kind preserves the user's last choice.
  const [modeByPath, setModeByPath] = useState<Map<string, string>>(
    () => new Map(),
  );

  if (visuals.length === 0) return <>{monacoElement}</>;

  // Default to "source" — the source view is the safe baseline for
  // every kind, and it preserves the editor flow for files the user
  // didn't explicitly switch.
  const mode = modeByPath.get(file.path) ?? "source";
  const setMode = (next: string) => {
    Sentry.metrics.count('editor_mode_switch', 1, {
      attributes: { to_mode: next, file_type: file.language }
    });
    setModeByPath((prev) => {
      const map = new Map(prev);
      map.set(file.path, next);
      return map;
    });
  };

  const activeVisual = visuals.find((v) => v.id === mode);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[#1a1a1a] bg-[#0a0a0a] shrink-0">
        <SubTabButton
          active={mode === "source"}
          onClick={() => setMode("source")}
          icon={<Code2 size={11} strokeWidth={1.6} />}
          label="Source"
        />
        {visuals.map((v) => (
          <SubTabButton
            key={v.id}
            active={mode === v.id}
            onClick={() => setMode(v.id)}
            icon={<LayoutGrid size={11} strokeWidth={1.6} />}
            label={v.label}
          />
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === "source" || !activeVisual ? (
          monacoElement
        ) : (
          <Suspense
            fallback={
              <div className="h-full flex items-center justify-center text-[11px] text-[#555]">
                Loading visual editor…
              </div>
            }
          >
            <ErrorBoundary name="Visual editor">
              <activeVisual.Component file={file} onChange={onContentChange} />
            </ErrorBoundary>
          </Suspense>
        )}
      </div>
    </div>
  );
};

interface SubTabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

const SubTabButton: React.FC<SubTabButtonProps> = ({
  active,
  onClick,
  icon,
  label,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${
      active
        ? "bg-white/10 text-white"
        : "text-[#666] hover:text-white hover:bg-white/5"
    }`}
    aria-pressed={active}
  >
    {icon}
    <span>{label}</span>
  </button>
);
