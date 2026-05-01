"use client";

import React, { useMemo } from "react";
import { Plus, Trash2, GripVertical, Info, FileSearch } from "lucide-react";
import type { VisualEditorProps } from "./getVisualEditor";
import { useDragReorder } from "@/hooks/useDragReorder";
import { useL10n } from "@/hooks/useL10n";

interface GitignoreRow {
  pattern: string;
  comment: string;
  raw: string | null;
  id: number;
}

function parseGitignore(text: string): GitignoreRow[] {
  const rows: GitignoreRow[] = [];
  const lines = text.split(/\r?\n/);
  let id = 0;
  
  const lastIsTrailing = lines.length > 0 && lines[lines.length - 1] === "";
  const effective = lastIsTrailing ? lines.slice(0, -1) : lines;
  
  for (const raw of effective) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      rows.push({ pattern: "", comment: "", raw, id: id++ });
      continue;
    }
    
    // Check for inline comment
    const hashIdx = raw.indexOf("#");
    if (hashIdx !== -1) {
      const pattern = raw.slice(0, hashIdx).trim();
      const comment = raw.slice(hashIdx + 1).trim();
      rows.push({ pattern, comment, raw, id: id++ });
    } else {
      rows.push({ pattern: trimmed, comment: "", raw, id: id++ });
    }
  }
  return rows;
}

function serializeGitignore(rows: GitignoreRow[]): string {
  const lines = rows.map((r) => {
    if (r.raw !== null) return r.raw;
    if (!r.pattern && !r.comment) return "";
    const head = r.pattern || "";
    const tail = r.comment ? ` # ${r.comment}` : "";
    return head + tail;
  });
  return lines.join("\n") + "\n";
}

const GitignoreEditor: React.FC<VisualEditorProps> = ({ file, onChange }) => {
  const { t } = useL10n();
  const rows = useMemo(() => parseGitignore(file.content), [file.content]);
  
  const commit = (next: GitignoreRow[]) => onChange(serializeGitignore(next));

  const updateRow = (id: number, patch: Partial<GitignoreRow>) => {
    commit(
      rows.map((r) =>
        r.id === id ? { ...r, ...patch, raw: null } : r,
      ),
    );
  };

  const removeRow = (id: number) => {
    commit(rows.filter((r) => r.id !== id));
  };

  const addRow = () => {
    const id = Math.max(0, ...rows.map((r) => r.id)) + 1;
    commit([...rows, { pattern: "", comment: "", raw: null, id }]);
  };

  const patternRows = rows.filter((r) => r.pattern !== "" || r.raw === null);
  const commentOnlyRows = rows.filter((r) => r.pattern === "" && r.raw !== null);

  const reorderPatterns = (next: GitignoreRow[]) => {
    const patIndices: number[] = [];
    rows.forEach((r, i) => {
      if (r.pattern !== "" || r.raw === null) patIndices.push(i);
    });
    
    const merged = rows.slice();
    for (let i = 0; i < patIndices.length; i++) {
      merged[patIndices[i]] = next[i];
    }
    commit(merged);
  };

  const { getRowProps } = useDragReorder<GitignoreRow>({
    items: patternRows,
    getId: (r) => r.id,
    onReorder: reorderPatterns,
  });

  return (
    <div className="h-full overflow-auto bg-[#0e0e0e] p-4 text-[12px] text-[#ccc]">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400">
                <FileSearch size={20} strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-white">{t('visual.gitignore.title')}</h2>
              <p className="text-[11px] text-[#666] mt-1">
                {t('visual.gitignore.desc')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-orange-500/15 hover:bg-orange-500/25 text-orange-300 border border-orange-500/30 transition-colors"
          >
            <Plus size={12} strokeWidth={1.8} />
            {t('visual.gitignore.add')}
          </button>
        </header>

        <div className="bg-surface-1/50 border border-border-subtle rounded-xl p-4 flex gap-3 items-start">
            <Info size={16} className="text-orange-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
                <p className="text-[11px] text-[#aaa]">
                    {t('visual.gitignore.info')}
                </p>
            </div>
        </div>

        <div className="border border-[#1a1a1a] rounded-xl overflow-hidden bg-[#0a0a0a]">
          <div className="grid grid-cols-[auto_1fr_auto] gap-2 px-3 py-2 border-b border-[#1a1a1a] bg-[#101010] text-[10px] font-bold text-[#666] uppercase tracking-wider">
            <span className="w-3" aria-hidden />
            <span>{t('visual.gitignore.pattern_placeholder')}</span>
            <span className="w-8" aria-hidden />
          </div>

          {patternRows.length === 0 && (
            <div className="px-3 py-8 text-center text-[11px] text-[#555] italic">
              {t('common.no_entries')}
            </div>
          )}

          {patternRows.map((r) => {
            const dragProps = getRowProps(r);
            return (
              <div
                key={r.id}
                {...dragProps}
                className={`grid grid-cols-[auto_1fr_auto] gap-2 px-3 py-2 border-b border-[#161616] last:border-b-0 items-center transition-opacity ${
                  dragProps["data-dragging"] ? "opacity-40" : ""
                } ${
                  dragProps["data-drag-target"] === "top"
                    ? "shadow-[inset_0_2px_0_0_#f97316]"
                    : ""
                } ${
                  dragProps["data-drag-target"] === "bottom"
                    ? "shadow-[inset_0_-2px_0_0_#f97316]"
                    : ""
                }`}
              >
                <span
                  className="cursor-grab active:cursor-grabbing text-[#444] hover:text-[#888] transition-colors"
                  aria-hidden
                >
                  <GripVertical size={12} strokeWidth={1.4} />
                </span>
                <input
                  type="text"
                  value={r.pattern}
                  spellCheck={false}
                  onChange={(e) => updateRow(r.id, { pattern: e.target.value })}
                  placeholder={t('visual.gitignore.pattern_placeholder')}
                  className="bg-[#0e0e0e] border border-[#1a1a1a] rounded px-3 py-1.5 text-[12px] font-mono text-white focus:border-orange-500/50 outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  title={t('common.remove')}
                  className="p-1.5 text-[#666] hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                  aria-label={t('common.remove')}
                >
                  <Trash2 size={13} strokeWidth={1.6} />
                </button>
              </div>
            );
          })}
        </div>

        {commentOnlyRows.length > 0 && (
          <p className="text-[10px] text-[#444] italic">
            {t('visual.gitignore.preserved', { count: commentOnlyRows.length })}
          </p>
        )}
      </div>
    </div>
  );
};

export default GitignoreEditor;
