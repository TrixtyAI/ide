"use client";

import React, { useRef } from "react";
import MonacoEditor, { OnMount, Monaco } from "@monaco-editor/react";
import { editor } from "monaco-editor";
import { useApp } from "@/context/AppContext";
import TabBar from "./TabBar";
import { useL10n } from "@/hooks/useL10n";
import MarketplaceView from "./MarketplaceView";
import { ErrorBoundary } from "./ErrorBoundary";

const EditorArea: React.FC = () => {
  const { currentFile, updateFileContent, openFiles, editorSettings } = useApp();
  const { t } = useL10n();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    monaco.editor.defineTheme('trixty-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'c678dd' },
        { token: 'keyword.control', foreground: 'c678dd' },
        { token: 'keyword.operator', foreground: 'c678dd' },
        { token: 'keyword.function', foreground: 'c678dd' },
        { token: 'storage', foreground: 'c678dd' },
        { token: 'storage.type', foreground: 'c678dd' },
        { token: 'storage.modifier', foreground: 'c678dd' },
        { token: 'variable.parameter', foreground: '61afef' },
        { token: 'variable.name', foreground: 'abb2bf' },
        { token: 'variable.other.property', foreground: '61afef' },
        { token: 'identifier', foreground: 'abb2bf' },
        { token: 'type', foreground: 'e5c07b' },
        { token: 'class', foreground: 'e5c07b' },
        { token: 'function', foreground: '61afef' },
        { token: 'string', foreground: '98c379' },
        { token: 'number', foreground: 'd19a66' },
        { token: 'constant', foreground: 'd19a66' },
        { token: 'operator', foreground: 'c678dd' },
        { token: 'delimiter', foreground: 'abb2bf' },
        { token: 'delimiter.bracket', foreground: 'c678dd' },
        { token: 'tag', foreground: 'e06c75' },
        { token: 'attribute.name', foreground: 'd19a66' },
        { token: 'attribute.value', foreground: '98c379' },
        { token: 'meta.preprocessor', foreground: 'c678dd' },
        { token: 'key', foreground: '61afef' },
      ],
      colors: {
        'editor.background': '#1c1c1c',
        'editor.foreground': '#abb2bf',
        'editorLineNumber.foreground': '#4b5263',
        'editorLineNumber.activeForeground': '#abb2bf',
        'editor.lineHighlightBackground': '#2c313a',
        'editorCursor.foreground': '#528bff',
        'editor.selectionBackground': '#3e445190',
        'editor.inactiveSelectionBackground': '#3e445140',
        'editorBracketMatch.background': '#515a6b',
        'editorBracketMatch.border': '#515a6b',
        'editorOverviewRuler.border': '#00000000',
        'editor.border': '#181a1f',
        'editorIndentGuide.background': '#3b4048',
        'editorIndentGuide.activeBackground': '#c678dd',
        'editorSuggestWidget.background': '#1c1c1c',
        'editorSuggestWidget.border': '#181a1f',
        'editorSuggestWidget.selectedBackground': '#2c313a',
        'editorWidget.background': '#1c1c1c',
        'editorWidget.border': '#181a1f',
      }
    });

    monaco.editor.setTheme('trixty-dark');

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
  }, [openPathKeys, currentFile?.path]);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

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
  return (
    <div className="flex-1 w-full h-full overflow-hidden flex flex-col bg-[#0e0e0e]">
      <TabBar />

      <div className="flex-1 overflow-hidden relative" ref={containerRef}>
        {isVirtualTab ? (
          renderVirtualView()
        ) : isBinaryTab ? (
          <div className="flex-1 h-full flex items-center justify-center p-8">
            <p className="text-[13px] text-[#888] max-w-md text-center leading-relaxed">
              {t('editor.bin_file')}
            </p>
          </div>
        ) : currentFile ? (
          <MonacoEditor
            key={currentFile.path}
            height="100%"
            language={currentFile.language}
            value={currentFile.content}
            theme="trixty-dark"
            onMount={handleEditorDidMount}
            onChange={handleEditorChange}
            path={currentFile.path}
            options={{
              minimap: { enabled: true },
              fontSize: editorSettings.fontSize,
              fontFamily: editorSettings.fontFamily,
              fontLigatures: true,
              lineHeight: editorSettings.lineHeight,
              letterSpacing: 0.5,
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
              automaticLayout: true, // Native layout handling
              padding: { top: 15 },
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              renderLineHighlight: "all",
              fixedOverflowWidgets: true,
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true },
              suggestOnTriggerCharacters: true,
              acceptSuggestionOnEnter: "on",
              quickSuggestions: true,
              tabCompletion: "on",
              wordBasedSuggestions: "currentDocument", // Performance
              parameterHints: { enabled: true },
              suggest: {
                showIcons: true
              },
              links: false, // Performance: Disable link scanning
              unicodeHighlight: {
                ambiguousCharacters: false,
                invisibleCharacters: false,
              }
            }}
          />
        ) : null}
      </div>
    </div>
  );
};

export default EditorArea;
