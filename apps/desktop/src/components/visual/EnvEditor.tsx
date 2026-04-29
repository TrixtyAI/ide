"use client";

import React, { useMemo, useState } from "react";
import { Plus, Trash2, Eye, EyeOff, GripVertical } from "lucide-react";
import type { VisualEditorProps } from "./getVisualEditor";
import { useDragReorder } from "@/hooks/useDragReorder";

interface EnvRow {
  /** "" for blank lines / pure-comment lines, otherwise the variable name. */
  key: string;
  value: string;
  /** Trailing comment without the leading `#`, or empty. */
  comment: string;
  /** Captures the original raw line so blank/comment-only lines round-trip
   *  exactly (whitespace, padding, etc.) when the user has not edited
   *  them. We re-serialize from `key/value/comment` only when one of
   *  those fields actually changed. */
  raw: string | null;
  /** Original index in the parsed list — used to keep order stable on
   *  edits and to detect which rows were synthesized by the user. */
  id: number;
}

/**
 * Round-trip-friendly `.env` parser. Preserves blank lines and comments
 * by capturing each source line into an `EnvRow` and replaying the
 * unchanged ones verbatim on serialization.
 *
 * Spec is the de-facto subset: KEY=VALUE per line, `#` introduces a line
 * or trailing comment, optional double-quoted values for strings with
 * spaces. Multi-line values are NOT supported (rare in practice; the
 * source view stays available for those edge cases).
 */
function parseEnv(text: string): EnvRow[] {
  const rows: EnvRow[] = [];
  const lines = text.split(/\r?\n/);
  let id = 0;
  // Drop a single trailing empty line so we don't surface the implicit
  // newline at end-of-file as an editable row.
  const lastIsTrailing = lines.length > 0 && lines[lines.length - 1] === "";
  const effective = lastIsTrailing ? lines.slice(0, -1) : lines;
  for (const raw of effective) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      rows.push({ key: "", value: "", comment: "", raw, id: id++ });
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      rows.push({ key: "", value: "", comment: "", raw, id: id++ });
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    let rest = trimmed.slice(eqIdx + 1);
    // Pull a trailing `# comment` only when the `#` is not inside quotes.
    let comment = "";
    if (!rest.startsWith('"')) {
      const hashIdx = rest.indexOf("#");
      if (hashIdx !== -1) {
        comment = rest.slice(hashIdx + 1).trim();
        rest = rest.slice(0, hashIdx).trim();
      } else {
        rest = rest.trim();
      }
    } else {
      // Quoted: scan character by character so an escaped quote (`\"`) or
      // escaped backslash (`\\`) inside the value doesn't terminate the
      // string early. Anything after the closing quote is treated as the
      // optional `# comment` chunk.
      let i = 1;
      let unescaped = "";
      let closeIdx = -1;
      while (i < rest.length) {
        const ch = rest[i];
        if (ch === "\\" && i + 1 < rest.length) {
          const next = rest[i + 1];
          if (next === "\\" || next === '"') {
            unescaped += next;
            i += 2;
            continue;
          }
        }
        if (ch === '"') {
          closeIdx = i;
          break;
        }
        unescaped += ch;
        i += 1;
      }
      if (closeIdx !== -1) {
        const after = rest.slice(closeIdx + 1).trim();
        rest = unescaped;
        if (after.startsWith("#")) comment = after.slice(1).trim();
      }
    }
    rows.push({ key, value: rest, comment, raw, id: id++ });
  }
  return rows;
}

function serializeEnv(rows: EnvRow[]): string {
  const lines = rows.map((r) => {
    if (r.raw !== null) return r.raw;
    // Synthesized row — render `KEY=VALUE` with quoting whenever the value
    // contains whitespace, `#`, `"`, or `\`. Quoting is also the trigger
    // for escaping: backslash MUST be escaped before quotes so a value
    // ending in `\` doesn't produce `\"` and accidentally re-open the
    // string when round-tripped through `parseEnv`.
    if (!r.key && !r.value && !r.comment) return "";
    const needsQuote = /[\s#"\\]/.test(r.value);
    const escaped = r.value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    const valueOut = needsQuote ? `"${escaped}"` : r.value;
    const head = r.key ? `${r.key}=${valueOut}` : "";
    const tail = r.comment ? ` # ${r.comment}` : "";
    return head + tail;
  });
  // Re-attach the implicit trailing newline so a round-trip on a file
  // that ended in `\n` doesn't strip it.
  return lines.join("\n") + "\n";
}

const EnvEditor: React.FC<VisualEditorProps> = ({ file, onChange }) => {
  // Parsed rows are fully derived from `file.content`; user edits flow
  // back through `onChange` so the next render re-derives from the
  // updated prop. Avoids the cascading-render trap of mirroring the
  // parsed list in local state.
  const rows = useMemo(() => parseEnv(file.content), [file.content]);
  // Reveal-toggle map is per-mount UI state (no serialization needed).
  // It gets implicitly reset when the parent remounts the editor on
  // file change — Suspense + dynamic import in the parent already
  // handles that.
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  const commit = (next: EnvRow[]) => onChange(serializeEnv(next));

  const updateRow = (id: number, patch: Partial<EnvRow>) => {
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
    commit([...rows, { key: "", value: "", comment: "", raw: null, id }]);
  };

  const variableRows = rows.filter((r) => r.key !== "" || r.raw === null);
  const commentOnlyRows = rows.filter((r) => r.key === "" && r.raw !== null);

  // Drag-to-reorder for the variable rows. We rebuild the full rows
  // array on drop by mapping each variable-row slot in the original
  // order to the user's new ordering — comment-only rows stay in
  // place so they don't migrate to the bottom of the file.
  const reorderVariables = (next: EnvRow[]) => {
    const varIndices: number[] = [];
    rows.forEach((r, i) => {
      if (r.key !== "" || r.raw === null) varIndices.push(i);
    });
    if (varIndices.length !== next.length) {
      commit(next.concat(commentOnlyRows));
      return;
    }
    const merged = rows.slice();
    for (let i = 0; i < varIndices.length; i++) {
      merged[varIndices[i]] = next[i];
    }
    commit(merged);
  };
  const { getRowProps } = useDragReorder<EnvRow>({
    items: variableRows,
    getId: (r) => r.id,
    onReorder: reorderVariables,
  });

  return (
    <div className="h-full overflow-auto bg-[#0e0e0e] p-4 text-[12px] text-[#ccc]">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-[14px] font-semibold text-white">Environment variables</h2>
            <p className="text-[11px] text-[#666] mt-1">
              Edits sync to the source view. Comments and blank lines are preserved.
            </p>
          </div>
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 transition-colors"
          >
            <Plus size={12} strokeWidth={1.8} />
            Add variable
          </button>
        </header>

        <div className="border border-[#1a1a1a] rounded-xl overflow-hidden bg-[#0a0a0a]">
          <div className="grid grid-cols-[auto_1fr_1.4fr_1fr_auto] gap-2 px-3 py-2 border-b border-[#1a1a1a] bg-[#101010] text-[10px] font-bold text-[#666] uppercase tracking-wider">
            <span className="w-3" aria-hidden />
            <span>Key</span>
            <span>Value</span>
            <span>Comment</span>
            <span className="w-8" aria-hidden />
          </div>

          {variableRows.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px] text-[#555] italic">
              No variables yet. Click &quot;Add variable&quot; to start.
            </div>
          )}

          {variableRows.map((r) => {
            const isRevealed = !!revealed[r.id];
            const dragProps = getRowProps(r);
            return (
              <div
                key={r.id}
                {...dragProps}
                className={`grid grid-cols-[auto_1fr_1.4fr_1fr_auto] gap-2 px-3 py-1.5 border-b border-[#161616] last:border-b-0 items-center transition-opacity ${
                  dragProps["data-dragging"] ? "opacity-40" : ""
                } ${
                  dragProps["data-drag-target"] === "top"
                    ? "shadow-[inset_0_2px_0_0_#3b82f6]"
                    : ""
                } ${
                  dragProps["data-drag-target"] === "bottom"
                    ? "shadow-[inset_0_-2px_0_0_#3b82f6]"
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
                  value={r.key}
                  spellCheck={false}
                  // Trim only on blur — `onChange` trim collapses
                  // intermediate states like "MY KEY" while typing
                  // (becomes "MYKEY") and breaks non-ASCII flow.
                  onChange={(e) => updateRow(r.id, { key: e.target.value })}
                  onBlur={(e) => {
                    const trimmed = e.target.value.trim();
                    if (trimmed !== r.key) updateRow(r.id, { key: trimmed });
                  }}
                  placeholder="KEY"
                  className="bg-[#0e0e0e] border border-[#1a1a1a] rounded px-2 py-1 text-[12px] font-mono text-white focus:border-blue-500/50 outline-none transition-colors"
                />
                <div className="relative">
                  <input
                    type={isRevealed ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    value={r.value}
                    onChange={(e) => updateRow(r.id, { value: e.target.value })}
                    placeholder="value"
                    className="w-full bg-[#0e0e0e] border border-[#1a1a1a] rounded px-2 py-1 pr-8 text-[12px] font-mono text-white focus:border-blue-500/50 outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setRevealed((s) => ({ ...s, [r.id]: !isRevealed }))
                    }
                    title={isRevealed ? "Hide value" : "Reveal value"}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-[#555] hover:text-white transition-colors"
                    aria-label={isRevealed ? "Hide value" : "Reveal value"}
                  >
                    {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
                <input
                  type="text"
                  value={r.comment}
                  onChange={(e) => updateRow(r.id, { comment: e.target.value })}
                  placeholder="comment (optional)"
                  className="bg-[#0e0e0e] border border-[#1a1a1a] rounded px-2 py-1 text-[12px] text-[#aaa] focus:border-blue-500/50 outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  title="Remove"
                  className="p-1 text-[#666] hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                  aria-label={`Remove ${r.key || "variable"}`}
                >
                  <Trash2 size={13} strokeWidth={1.6} />
                </button>
              </div>
            );
          })}
        </div>

        {commentOnlyRows.length > 0 && (
          <p className="text-[10px] text-[#444] italic">
            {commentOnlyRows.length} comment / blank line preserved verbatim.
          </p>
        )}
      </div>
    </div>
  );
};

export default EnvEditor;
