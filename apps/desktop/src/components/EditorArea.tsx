"use client";

import React, { useRef } from "react";
import MonacoEditor, { OnMount } from "@monaco-editor/react";
import { useApp } from "@/context/AppContext";
import TabBar from "./TabBar";
import { useL10n } from "@/hooks/useL10n";
import MarketplaceView from "./MarketplaceView";

const EditorArea: React.FC = () => {
  const { currentFile, updateFileContent, openFiles, editorSettings } = useApp();
  const { t } = useL10n();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

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
  };

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const handleEditorChange = (value: string | undefined) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      if (currentFile) {
        updateFileContent(currentFile.path, value || "");
      }
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

  // Render virtual views
  const renderVirtualView = () => {
    switch (currentFile?.path) {
      case "virtual://extensions":
        return <MarketplaceView />;
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

      <div className="flex-1 overflow-hidden relative">
        {isVirtualTab ? (
          renderVirtualView()
        ) : currentFile ? (
          <MonacoEditor
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
              automaticLayout: true,
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
              wordBasedSuggestions: "allDocuments",
              parameterHints: { enabled: true },
              suggest: {
                showIcons: true
              }
            }}
          />
        ) : null}
      </div>
    </div>
  );
};

export default EditorArea;
