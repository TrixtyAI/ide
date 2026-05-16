"use client";

import React, { useMemo, useState, useEffect } from "react";
import { Plus, Trash2, AlertTriangle, Package, GripVertical } from "lucide-react";
import { useWorkspace } from "@/context/WorkspaceContext";
import type { VisualEditorProps } from "./getVisualEditor";
import NpmInstallerModal from "./NpmInstallerModal";
import { useDragReorder, type DragRowProps } from "@/hooks/useDragReorder";
import { useL10n } from "@/hooks/useL10n";

type DepGroup = "dependencies" | "devDependencies" | "peerDependencies";

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  author?: string | { name?: string; email?: string };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  [k: string]: unknown;
}

interface ParsedState {
  data: PackageJson | null;
  error: string | null;
}

function parse(text: string): ParsedState {
  const trimmed = text.trim();
  if (trimmed === "") return { data: {}, error: null };
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return { data: obj as PackageJson, error: null };
    }
    return { data: null, error: "package.json must be a JSON object" };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

function stringify(data: PackageJson): string {
  return JSON.stringify(data, null, 2) + "\n";
}

const PackageJsonEditor: React.FC<VisualEditorProps> = ({ file, onChange }) => {
  const { t } = useL10n();
  const { rootPath } = useWorkspace();
  // Parsed package.json is derived directly from the prop — user edits
  // flow back through onChange and re-derive on next render.
  const state = useMemo(() => parse(file.content), [file.content]);
  const [installerTarget, setInstallerTarget] = useState<DepGroup | null>(null);

  const data = state.data;

  const commit = (next: PackageJson) => {
    onChange(stringify(next));
  };

  if (state.error || !data) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0e0e0e] p-6 text-center">
        <div className="max-w-md p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-[12px] text-amber-200/85 flex flex-col items-center gap-3">
          <AlertTriangle size={20} strokeWidth={1.6} className="text-amber-400/80" />
          <p className="font-bold text-amber-300/90">package.json parse error</p>
          <p className="font-mono text-[11px] break-all">{state.error}</p>
          <p className="text-[11px] text-[#888]">
            Switch to the source view to fix the syntax. The form picks up
            automatically once the file parses.
          </p>
        </div>
      </div>
    );
  }

  const updateScalar = (key: keyof PackageJson, value: string) => {
    const next = { ...data, [key]: value };
    if (value === "") delete next[key];
    commit(next);
  };

  const updateAuthor = (value: string) => {
    const next = { ...data };
    if (value.trim() === "") delete next.author;
    else next.author = value;
    commit(next);
  };

  const updateMapEntry = (
    key: "scripts" | DepGroup | "engines",
    name: string,
    value: string,
  ) => {
    const map = { ...(data[key] ?? {}) } as Record<string, string>;
    if (value === "") delete map[name];
    else map[name] = value;
    const next = { ...data, [key]: map };
    if (Object.keys(map).length === 0) delete next[key];
    commit(next);
  };

  const renameMapKey = (
    key: "scripts" | DepGroup | "engines",
    oldName: string,
    newName: string,
  ) => {
    if (oldName === newName) return;
    const map = { ...(data[key] ?? {}) } as Record<string, string>;
    if (newName.trim() === "") return;
    const ordered: Record<string, string> = {};
    for (const k of Object.keys(map)) {
      ordered[k === oldName ? newName : k] = map[k];
    }
    commit({ ...data, [key]: ordered });
  };

  const removeMapEntry = (
    key: "scripts" | DepGroup | "engines",
    name: string,
  ) => {
    const map = { ...(data[key] ?? {}) } as Record<string, string>;
    delete map[name];
    const next = { ...data, [key]: map };
    if (Object.keys(map).length === 0) delete next[key];
    commit(next);
  };

  /** Drag-reorder support: rebuild the section's map preserving the
   *  caller-provided key order. JS spec keeps insertion order for
   *  string keys, so the on-disk JSON.stringify output reflects the
   *  user's drag exactly. */
  const reorderMapKeys = (
    key: "scripts" | DepGroup | "engines",
    keysInOrder: string[],
  ) => {
    const map = (data[key] ?? {}) as Record<string, string>;
    const reordered: Record<string, string> = {};
    for (const k of keysInOrder) {
      if (k in map) reordered[k] = map[k];
    }
    // Preserve any keys we didn't see in `keysInOrder` (defensive —
    // the caller supplies the visible row order; if it gets out of
    // sync with `entries`, we still keep the extras at the tail).
    for (const k of Object.keys(map)) {
      if (!(k in reordered)) reordered[k] = map[k];
    }
    commit({ ...data, [key]: reordered });
  };

  const addMapEntry = (
    key: "scripts" | "engines",
    name: string,
    value: string,
  ) => {
    if (!name.trim()) return;
    const map = { ...(data[key] ?? {}) } as Record<string, string>;
    map[name.trim()] = value;
    commit({ ...data, [key]: map });
  };

  const onPackageInstalled = (target: DepGroup, pkgName: string, pkgVersion: string) => {
    const map = { ...(data[target] ?? {}) } as Record<string, string>;
    map[pkgName] = pkgVersion;
    commit({ ...data, [target]: map });
  };

  return (
    <div className="h-full overflow-auto bg-[#0e0e0e] p-4 text-[12px] text-[#ccc]">
      <div className="max-w-3xl mx-auto space-y-8">
        <Section title={t('visual.package.identity')}>
          <Field label={t('visual.package.name')}>
            <input
              type="text"
              value={data.name ?? ""}
              onChange={(e) => updateScalar("name", e.target.value)}
              placeholder="my-package"
              className={fieldClass}
            />
          </Field>
          <Field label={t('visual.package.version')}>
            <input
              type="text"
              value={data.version ?? ""}
              onChange={(e) => updateScalar("version", e.target.value)}
              placeholder="0.0.0"
              className={fieldClass}
            />
          </Field>
          <Field label={t('visual.package.description')}>
            <input
              type="text"
              value={data.description ?? ""}
              onChange={(e) => updateScalar("description", e.target.value)}
              placeholder="One-liner about the package"
              className={fieldClass}
            />
          </Field>
          <Field label={t('visual.package.license')}>
            <input
              type="text"
              value={data.license ?? ""}
              onChange={(e) => updateScalar("license", e.target.value)}
              placeholder="MIT"
              className={fieldClass}
            />
          </Field>
          <Field label={t('visual.package.author')}>
            <input
              type="text"
              value={
                typeof data.author === "string"
                  ? data.author
                  : data.author?.name ?? ""
              }
              onChange={(e) => updateAuthor(e.target.value)}
              placeholder="Jane Doe <jane@example.com>"
              className={fieldClass}
            />
          </Field>
        </Section>

        <MapSection
          title={t('visual.package.scripts')}
          entries={data.scripts ?? {}}
          placeholderKey="dev"
          placeholderValue="next dev"
          onUpdateValue={(k, v) => updateMapEntry("scripts", k, v)}
          onRenameKey={(oldK, newK) => renameMapKey("scripts", oldK, newK)}
          onRemove={(k) => removeMapEntry("scripts", k)}
          onAdd={(k, v) => addMapEntry("scripts", k, v)}
        />

        <DepSection
          title={t('visual.package.dependencies')}
          target="dependencies"
          entries={data.dependencies ?? {}}
          rootPath={rootPath}
          onOpenInstaller={() => setInstallerTarget("dependencies")}
          onUpdateValue={(k, v) => updateMapEntry("dependencies", k, v)}
          onRenameKey={(oldK, newK) => renameMapKey("dependencies", oldK, newK)}
          onRemove={(k) => removeMapEntry("dependencies", k)}
          onReorder={(keys) => reorderMapKeys("dependencies", keys)}
        />
        <DepSection
          title={t('visual.package.dev_dependencies')}
          target="devDependencies"
          entries={data.devDependencies ?? {}}
          rootPath={rootPath}
          onOpenInstaller={() => setInstallerTarget("devDependencies")}
          onUpdateValue={(k, v) => updateMapEntry("devDependencies", k, v)}
          onRenameKey={(oldK, newK) => renameMapKey("devDependencies", oldK, newK)}
          onRemove={(k) => removeMapEntry("devDependencies", k)}
          onReorder={(keys) => reorderMapKeys("devDependencies", keys)}
        />
        <DepSection
          title={t('visual.package.peer_dependencies')}
          target="peerDependencies"
          entries={data.peerDependencies ?? {}}
          rootPath={rootPath}
          onOpenInstaller={() => setInstallerTarget("peerDependencies")}
          onUpdateValue={(k, v) => updateMapEntry("peerDependencies", k, v)}
          onRenameKey={(oldK, newK) => renameMapKey("peerDependencies", oldK, newK)}
          onRemove={(k) => removeMapEntry("peerDependencies", k)}
          onReorder={(keys) => reorderMapKeys("peerDependencies", keys)}
        />

        <MapSection
          title={t('visual.package.engines')}
          entries={data.engines ?? {}}
          placeholderKey="node"
          placeholderValue=">=20"
          onUpdateValue={(k, v) => updateMapEntry("engines", k, v)}
          onRenameKey={(oldK, newK) => renameMapKey("engines", oldK, newK)}
          onRemove={(k) => removeMapEntry("engines", k)}
          onAdd={(k, v) => addMapEntry("engines", k, v)}
        />
      </div>

      {installerTarget && rootPath && (
        <NpmInstallerModal
          open={installerTarget !== null}
          onClose={() => setInstallerTarget(null)}
          rootPath={rootPath}
          target={installerTarget}
          onInstalled={(name, version) =>
            onPackageInstalled(installerTarget, name, version)
          }
        />
      )}
    </div>
  );
};

const fieldClass =
  "w-full bg-[#0e0e0e] border border-[#1a1a1a] rounded px-3 py-1.5 text-[12px] text-white focus:border-blue-500/50 outline-none transition-colors";

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section className="space-y-3 border border-[#1a1a1a] rounded-2xl p-5 bg-[#0a0a0a]">
    <h3 className="text-[13px] font-bold text-white tracking-tight">{title}</h3>
    <div className="grid grid-cols-2 gap-3">{children}</div>
  </section>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <label className="flex flex-col gap-1.5 col-span-2 md:col-span-1 last:col-span-2">
    <span className="text-[10px] font-bold text-[#888] uppercase tracking-wider">
      {label}
    </span>
    {children}
  </label>
);

interface MapSectionProps {
  title: string;
  entries: Record<string, string>;
  placeholderKey: string;
  placeholderValue: string;
  onUpdateValue: (k: string, v: string) => void;
  onRenameKey: (oldK: string, newK: string) => void;
  onRemove: (k: string) => void;
  onAdd: (k: string, v: string) => void;
}

const MapSection: React.FC<MapSectionProps> = ({
  title,
  entries,
  placeholderKey,
  placeholderValue,
  onUpdateValue,
  onRenameKey,
  onRemove,
  onAdd,
}) => {
  const { t } = useL10n();
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");

  const submit = () => {
    if (!draftKey.trim()) return;
    onAdd(draftKey, draftValue);
    setDraftKey("");
    setDraftValue("");
  };

  return (
    <section className="space-y-3 border border-[#1a1a1a] rounded-2xl p-5 bg-[#0a0a0a]">
      <header className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-white tracking-tight">{title}</h3>
        <span className="text-[10px] text-[#444] font-mono">
          {Object.keys(entries).length} {t('marketplace.metadata.identifier').toLowerCase()}
        </span>
      </header>

      <div className="space-y-1">
        {Object.entries(entries).map(([k, v]) => (
          <Row
            key={k}
            entryKey={k}
            entryValue={v}
            onRenameKey={onRenameKey}
            onUpdateValue={onUpdateValue}
            onRemove={onRemove}
          />
        ))}
        {Object.keys(entries).length === 0 && (
          <p className="text-[11px] text-[#555] italic">{t('common.no_entries')}</p>
        )}
      </div>

      <div className="flex gap-2 pt-2 border-t border-[#161616]">
        <input
          type="text"
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholderKey}
          className="flex-1 bg-[#0e0e0e] border border-[#1a1a1a] rounded px-2 py-1 text-[12px] font-mono text-white focus:border-blue-500/50 outline-none transition-colors"
        />
        <input
          type="text"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholderValue}
          className="flex-1 bg-[#0e0e0e] border border-[#1a1a1a] rounded px-2 py-1 text-[12px] font-mono text-white focus:border-blue-500/50 outline-none transition-colors"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draftKey.trim()}
          className="px-3 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 transition-colors bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={11} strokeWidth={1.8} />
          {t('common.add')}
        </button>
      </div>
    </section>
  );
};

interface DepSectionProps {
  title: string;
  target: DepGroup;
  entries: Record<string, string>;
  rootPath: string | null;
  onOpenInstaller: () => void;
  onUpdateValue: (k: string, v: string) => void;
  onRenameKey: (oldK: string, newK: string) => void;
  onRemove: (k: string) => void;
  onReorder: (keysInOrder: string[]) => void;
}

const DepSection: React.FC<DepSectionProps> = ({
  title,
  entries,
  rootPath,
  onOpenInstaller,
  onUpdateValue,
  onRenameKey,
  onRemove,
  onReorder,
}) => {
  const { t } = useL10n();
  const rows = Object.entries(entries).map(([key, value]) => ({ key, value }));
  const { getRowProps } = useDragReorder<{ key: string; value: string }>({
    items: rows,
    getId: (r) => r.key,
    onReorder: (next) => onReorder(next.map((r) => r.key)),
  });

  return (
    <section className="space-y-3 border border-[#1a1a1a] rounded-2xl p-5 bg-[#0a0a0a]">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package size={13} className="text-[#666]" />
          <h3 className="text-[13px] font-bold text-white tracking-tight">{title}</h3>
        </div>
        <button
          type="button"
          onClick={onOpenInstaller}
          disabled={!rootPath}
          title={rootPath ? "Search npm" : "Open a workspace folder first"}
          className="px-3 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 transition-colors bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={11} strokeWidth={1.8} />
          {t('common.add')}
        </button>
      </header>
      <div className="space-y-1">
        {rows.map((r) => {
          const drag = getRowProps(r);
          return (
            <Row
              key={r.key}
              entryKey={r.key}
              entryValue={r.value}
              onRenameKey={onRenameKey}
              onUpdateValue={onUpdateValue}
              onRemove={onRemove}
              dragProps={drag}
            />
          );
        })}
        {rows.length === 0 && (
          <p className="text-[11px] text-[#555] italic">{t('common.no_entries')}</p>
        )}
      </div>
    </section>
  );
};

interface RowProps {
  entryKey: string;
  entryValue: string;
  onRenameKey: (oldK: string, newK: string) => void;
  onUpdateValue: (k: string, v: string) => void;
  onRemove: (k: string) => void;
  dragProps?: DragRowProps;
}

const Row: React.FC<RowProps> = ({
  entryKey,
  entryValue,
  onRenameKey,
  onUpdateValue,
  onRemove,
  dragProps,
}) => {
  const { t } = useL10n();
  const [draftKey, setDraftKey] = useState(entryKey);
  useEffect(() => {
    setDraftKey(entryKey);
  }, [entryKey]);
  const dragTarget = dragProps?.["data-drag-target"];
  const dragging = dragProps?.["data-dragging"];
  return (
    <div
      {...dragProps}
      className={`grid grid-cols-[auto_1fr_1.4fr_auto] gap-2 items-center transition-opacity ${
        dragging ? "opacity-40" : ""
      } ${
        dragTarget === "top"
          ? "shadow-[inset_0_2px_0_0_#3b82f6]"
          : dragTarget === "bottom"
            ? "shadow-[inset_0_-2px_0_0_#3b82f6]"
            : ""
      }`}
    >
      <span
        className="cursor-grab active:cursor-grabbing text-[#444] hover:text-[#888] transition-colors px-1"
        aria-hidden
      >
        <GripVertical size={12} strokeWidth={1.4} />
      </span>
      <input
        type="text"
        value={draftKey}
        onChange={(e) => setDraftKey(e.target.value)}
        onBlur={() => {
          if (draftKey !== entryKey && draftKey.trim() !== "") {
            onRenameKey(entryKey, draftKey);
          } else {
            setDraftKey(entryKey);
          }
        }}
        className="bg-[#0e0e0e] border border-[#1a1a1a] rounded px-2 py-1 text-[12px] font-mono text-white focus:border-blue-500/50 outline-none transition-colors"
      />
      <input
        type="text"
        value={entryValue}
        onChange={(e) => onUpdateValue(entryKey, e.target.value)}
        className="bg-[#0e0e0e] border border-[#1a1a1a] rounded px-2 py-1 text-[12px] font-mono text-white focus:border-blue-500/50 outline-none transition-colors"
      />
      <button
        type="button"
        onClick={() => onRemove(entryKey)}
        title={t('common.remove')}
        className="p-1 text-[#666] hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
        aria-label={t('common.remove')}
      >
        <Trash2 size={13} strokeWidth={1.6} />
      </button>
    </div>
  );
};

export default PackageJsonEditor;
