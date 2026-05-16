"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  AlertTriangle,
  FileWarning,
} from "lucide-react";
import type { VisualEditorProps } from "./getVisualEditor";

/**
 * Files larger than this are kept on the source view — re-stringifying
 * the entire tree on every keystroke (which is what `commit()` has to
 * do to round-trip through the file content) starts to stall the UI
 * thread well before this point. 512 KB is generous for hand-edited
 * JSON; auto-generated files like `package-lock.json` blow past it.
 */
const LARGE_FILE_BYTES = 512 * 1024;

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Path is the array of keys / indices from root to a given node. */
type JsonPath = (string | number)[];

interface ParsedState {
  root: JsonValue | null;
  error: string | null;
}

function parse(text: string): ParsedState {
  const trimmed = text.trim();
  if (trimmed === "") return { root: {}, error: null };
  try {
    return { root: JSON.parse(text) as JsonValue, error: null };
  } catch (err) {
    return { root: null, error: String(err) };
  }
}

function stringify(value: JsonValue): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function getAt(root: JsonValue, path: JsonPath): JsonValue {
  let cur: JsonValue = root;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return null;
    if (Array.isArray(cur)) {
      if (typeof k !== "number") return null;
      cur = cur[k] ?? null;
    } else {
      if (typeof k !== "string") return null;
      cur = cur[k] ?? null;
    }
  }
  return cur;
}

/** Immutable update at the given path. Returns a fresh root. */
function setAt(root: JsonValue, path: JsonPath, value: JsonValue): JsonValue {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const idx = head as number;
    const next = root.slice();
    next[idx] = setAt(next[idx] ?? null, rest, value);
    return next;
  }
  if (root && typeof root === "object") {
    const key = head as string;
    const obj = { ...(root as Record<string, JsonValue>) };
    obj[key] = setAt(obj[key] ?? null, rest, value);
    return obj;
  }
  // Hitting a primitive mid-path means we lost containerness; rebuild
  // from the current head shape.
  if (typeof head === "number") {
    const next: JsonValue[] = [];
    next[head] = setAt(null, rest, value);
    return next;
  }
  return { [head]: setAt(null, rest, value) } as JsonValue;
}

function deleteAt(root: JsonValue, path: JsonPath): JsonValue {
  if (path.length === 0) return root;
  if (path.length === 1) {
    const head = path[0];
    if (Array.isArray(root)) {
      return root.filter((_, i) => i !== head);
    }
    if (root && typeof root === "object") {
      const obj = { ...(root as Record<string, JsonValue>) };
      delete obj[head as string];
      return obj;
    }
    return root;
  }
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const next = root.slice();
    next[head as number] = deleteAt(next[head as number] ?? null, rest);
    return next;
  }
  if (root && typeof root === "object") {
    const obj = { ...(root as Record<string, JsonValue>) };
    obj[head as string] = deleteAt(obj[head as string] ?? null, rest);
    return obj;
  }
  return root;
}

function renameKey(
  root: JsonValue,
  parentPath: JsonPath,
  oldKey: string,
  newKey: string,
): JsonValue {
  if (oldKey === newKey) return root;
  const parent = getAt(root, parentPath);
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) return root;
  // Preserve key insertion order so the source diff stays minimal.
  const obj = parent as Record<string, JsonValue>;
  const next: Record<string, JsonValue> = {};
  for (const k of Object.keys(obj)) {
    next[k === oldKey ? newKey : k] = obj[k];
  }
  return setAt(root, parentPath, next as JsonValue);
}

function valueLabel(v: JsonValue): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array (${v.length})`;
  if (typeof v === "object") return `object (${Object.keys(v).length})`;
  if (typeof v === "string") return `"${v.length > 40 ? v.slice(0, 40) + "…" : v}"`;
  return String(v);
}

const JsonTreeEditor: React.FC<VisualEditorProps> = ({ file, onChange }) => {
  const isLarge = file.content.length > LARGE_FILE_BYTES;
  // Parsed root + error are derived directly from the prop. User edits
  // flow back through onChange so the next render sees the updated
  // content via the same `useMemo`. No local mirror = no
  // setState-in-effect.
  const state = useMemo(
    () => (isLarge ? { root: null, error: null } : parse(file.content)),
    [file.content, isLarge],
  );

  // Track the last serialization we wrote out so a no-op edit
  // (toggling a boolean back and forth) does not bounce the
  // surrounding system through React + Monaco unnecessarily. The size
  // guard above keeps the file small enough that one synchronous
  // `JSON.stringify` per keystroke is cheap, so the previous debounce
  // + optimistic-mirror complexity is unnecessary here.
  const lastCommittedRef = useRef<string>(file.content);

  const commit = (next: JsonValue) => {
    const serialized = stringify(next);
    if (serialized === lastCommittedRef.current) return;
    lastCommittedRef.current = serialized;
    onChange(serialized);
  };

  if (isLarge) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0e0e0e] p-6 text-center">
        <div className="max-w-md p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-[12px] text-amber-200/85 flex flex-col items-center gap-3">
          <FileWarning size={20} strokeWidth={1.6} className="text-amber-400/80" />
          <p className="font-bold text-amber-300/90">Large JSON file</p>
          <p className="text-[11px] text-[#888]">
            Files over {Math.round(LARGE_FILE_BYTES / 1024)} KB stay on the
            source view to keep editing responsive. Switch to Source above
            to edit this file.
          </p>
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0e0e0e] p-6 text-center">
        <div className="max-w-md p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-[12px] text-amber-200/85 flex flex-col items-center gap-3">
          <AlertTriangle size={20} strokeWidth={1.6} className="text-amber-400/80" />
          <p className="font-bold text-amber-300/90">JSON parse error</p>
          <p className="font-mono text-[11px] break-all">{state.error}</p>
          <p className="text-[11px] text-[#888]">
            Switch to the source view to fix the syntax — the visual editor
            will pick up automatically once the file parses.
          </p>
        </div>
      </div>
    );
  }

  const root = state.root ?? {};

  return (
    <div className="h-full overflow-auto bg-[#0e0e0e] p-4 text-[12px] text-[#ccc] font-mono">
      <div className="max-w-3xl mx-auto">
        <Node
          value={root}
          path={[]}
          rootValue={root}
          onChange={commit}
          isRoot
        />
      </div>
    </div>
  );
};

interface NodeProps {
  value: JsonValue;
  path: JsonPath;
  rootValue: JsonValue;
  onChange: (next: JsonValue) => void;
  isRoot?: boolean;
  /** Label to render in front of the value: a string for object keys, a
   *  number for array indices, undefined for the root. */
  label?: string | number;
  /** Called when the parent should remove this node entirely. */
  onRemove?: () => void;
  /** Called with a new key when this node is an object property and its
   *  key was edited. Undefined for array items / root. */
  onRenameKey?: (next: string) => void;
}

const Node: React.FC<NodeProps> = ({
  value,
  path,
  rootValue,
  onChange,
  isRoot,
  label,
  onRemove,
  onRenameKey,
}) => {
  const [open, setOpen] = useState(true);
  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const isContainer = isObject || isArray;

  const setValueAtThis = (next: JsonValue) => {
    onChange(setAt(rootValue, path, next));
  };

  const addChild = () => {
    if (isObject) {
      const obj = { ...(value as Record<string, JsonValue>) };
      let i = 1;
      while (`new_key_${i}` in obj) i++;
      obj[`new_key_${i}`] = "";
      setValueAtThis(obj);
    } else if (isArray) {
      setValueAtThis([...(value as JsonValue[]), ""]);
    }
  };

  if (!isContainer) {
    return (
      <div className="flex items-center gap-2 py-0.5 group">
        {onRenameKey ? (
          <input
            value={(label ?? "") as string}
            onChange={(e) => onRenameKey(e.target.value)}
            spellCheck={false}
            className="text-[12px] text-[#61afef] bg-transparent border-b border-transparent hover:border-[#1a1a1a] focus:border-blue-500/50 outline-none px-1 min-w-[60px]"
          />
        ) : label !== undefined ? (
          <span className="text-[12px] text-[#666]">{label}</span>
        ) : null}
        <span className="text-[#444]">:</span>
        <PrimitiveInput value={value} onChange={setValueAtThis} />
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove"
            className="opacity-0 group-hover:opacity-100 p-1 text-[#666] hover:text-red-400 transition-opacity"
            aria-label="Remove"
          >
            <Trash2 size={11} strokeWidth={1.6} />
          </button>
        )}
      </div>
    );
  }

  const containerKeys = isObject
    ? Object.keys(value as Record<string, JsonValue>)
    : (value as JsonValue[]).map((_, i) => i);

  return (
    <div className="py-0.5">
      <div className="flex items-center gap-1 group">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="p-0.5 text-[#666] hover:text-white transition-colors"
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {onRenameKey ? (
          <input
            value={(label ?? "") as string}
            onChange={(e) => onRenameKey(e.target.value)}
            spellCheck={false}
            className="text-[12px] text-[#61afef] bg-transparent border-b border-transparent hover:border-[#1a1a1a] focus:border-blue-500/50 outline-none px-1 min-w-[60px]"
          />
        ) : label !== undefined ? (
          <span className="text-[12px] text-[#666]">{label}</span>
        ) : null}
        {!isRoot && <span className="text-[#444]">:</span>}
        <span className="text-[10px] text-[#555] italic">{valueLabel(value)}</span>
        <button
          type="button"
          onClick={addChild}
          title={isObject ? "Add property" : "Add item"}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-[#666] hover:text-blue-400 transition-opacity"
          aria-label="Add child"
        >
          <Plus size={11} strokeWidth={1.6} />
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove"
            className="opacity-0 group-hover:opacity-100 p-0.5 text-[#666] hover:text-red-400 transition-opacity"
            aria-label="Remove"
          >
            <Trash2 size={11} strokeWidth={1.6} />
          </button>
        )}
      </div>

      {open && (
        <div className="ml-4 border-l border-[#1a1a1a] pl-3">
          {containerKeys.map((k) => {
            const childPath = [...path, k];
            const childValue = isObject
              ? (value as Record<string, JsonValue>)[k as string]
              : (value as JsonValue[])[k as number];
            return (
              <Node
                key={String(k)}
                value={childValue}
                path={childPath}
                rootValue={rootValue}
                onChange={onChange}
                label={k}
                onRemove={() => onChange(deleteAt(rootValue, childPath))}
                onRenameKey={
                  isObject
                    ? (next) => onChange(renameKey(rootValue, path, k as string, next))
                    : undefined
                }
              />
            );
          })}
          {containerKeys.length === 0 && (
            <span className="text-[11px] text-[#555] italic">empty</span>
          )}
        </div>
      )}
    </div>
  );
};

interface PrimitiveInputProps {
  value: JsonValue;
  onChange: (next: JsonValue) => void;
}

const PrimitiveInput: React.FC<PrimitiveInputProps> = ({ value, onChange }) => {
  // Strings render as a plain text input; numbers / booleans / null get
  // a typed-aware control. The "type cycle" button on the right lets the
  // user convert between primitive types in place.
  if (typeof value === "string") {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-[120px] bg-[#0e0e0e] border border-[#1a1a1a] rounded px-2 py-0.5 text-[12px] text-[#98c379] focus:border-blue-500/50 outline-none transition-colors"
      />
    );
  }
  if (typeof value === "number") {
    return (
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n)) onChange(n);
        }}
        className="flex-1 min-w-[80px] bg-[#0e0e0e] border border-[#1a1a1a] rounded px-2 py-0.5 text-[12px] text-[#d19a66] focus:border-blue-500/50 outline-none transition-colors"
      />
    );
  }
  if (typeof value === "boolean") {
    return (
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider transition-colors border ${
          value
            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/25"
            : "bg-[#1a1a1a] text-[#666] border-white/5"
        }`}
      >
        {String(value)}
      </button>
    );
  }
  if (value === null) {
    return (
      <button
        type="button"
        onClick={() => onChange("")}
        className="px-2 py-0.5 rounded text-[11px] italic text-[#666] border border-[#1a1a1a] hover:border-blue-500/50 hover:text-white transition-colors"
        title="Click to convert to string"
      >
        null
      </button>
    );
  }
  return null;
};

export default JsonTreeEditor;
