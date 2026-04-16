"use client";

import React from "react";
import Editor, { OnMount } from "@monaco-editor/react";

interface CodeEditorProps {
  value: string;
  language?: string;
  onChange?: (value: string | undefined) => void;
  onMount?: OnMount;
}

const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  language = "typescript",
  onChange,
  onMount
}) => {
  return (
    <div className="w-full h-full">
      <Editor
        height="100%"
        defaultLanguage={language}
        theme="vs-dark"
        value={value}
        onChange={onChange}
        onMount={(editor, monaco) => {
          // Apply custom indentation from Registry if available
          if (window.trixty?.languages) {
            const indent = window.trixty.languages.getIndentation(language);
            if (indent) {
              const model = editor.getModel();
              if (model) {
                model.updateOptions({
                  tabSize: indent.tabSize,
                  insertSpaces: indent.insertSpaces
                });
              }
            }
          }
          if (onMount) onMount(editor, monaco);
        }}
        options={{
          fontSize: 20,
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorSmoothCaretAnimation: "on",
          padding: { top: 10 },
          lineNumbers: "on",
          renderLineHighlight: "all",
          scrollbar: {
            vertical: "visible",
            horizontal: "visible",
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
          fontLigatures: true,
        }}
      />
    </div>
  );
};

export default CodeEditor;
