"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Package, X, Download, Loader2 } from "lucide-react";
import { searchNpm, type NpmSearchHit } from "@/api/npmRegistry";
import {
  detectPackageManager,
  installVerb,
  type PackageManagerInfo,
  type PackageManagerId,
} from "@/api/packageManagerDetect";
import { safeInvoke as invoke } from "@/api/tauri";
import { logger } from "@/lib/logger";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface NpmInstallerModalProps {
  open: boolean;
  onClose: () => void;
  rootPath: string;
  /** Variant of the dependency block we are adding to.
   *  - `dependencies`     → installer flag absent (default)
   *  - `devDependencies`  → `--save-dev` for npm/yarn, `-D` for pnpm/bun
   *  - `peerDependencies` → no install (just adds to package.json — npm
   *    has no first-class flag for it). The caller writes this back to
   *    package.json directly via the form editor. */
  target: "dependencies" | "devDependencies" | "peerDependencies";
  /** Called with the package name + version after the install pipeline
   *  resolves. The caller is responsible for any state updates that go
   *  beyond running the install (e.g. seeding a row in the form editor
   *  for `peerDependencies`). */
  onInstalled: (pkgName: string, pkgVersion: string) => void;
}

const SEARCH_DEBOUNCE_MS = 250;

const NpmInstallerModal: React.FC<NpmInstallerModalProps> = ({
  open,
  onClose,
  rootPath,
  target,
  onInstalled,
}) => {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<NpmSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [pms, setPms] = useState<PackageManagerInfo[]>([]);
  const [selectedPm, setSelectedPm] = useState<PackageManagerId | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useFocusTrap({ active: open, containerRef: dialogRef, onEscape: onClose });

  // Probe the workspace once per open so the PM list reflects what the
  // user has installed today. Lockfile-pinned PMs land first so the
  // default selection matches the project's existing convention.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    detectPackageManager(rootPath).then((next) => {
      if (cancelled) return;
      setPms(next);
      const pinned = next.find((p) => p.detectedFromLockfile && p.available);
      const fallback = next.find((p) => p.available);
      setSelectedPm(pinned?.id ?? fallback?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, rootPath]);

  // Focus the search input on open.
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => inputRef.current?.focus());
  }, [open]);

  // Debounced search against the npm registry. Cancels via
  // `cancelled`-flag closure so a stale result never overwrites a newer
  // one when the user keeps typing.
  useEffect(() => {
    if (!open) return;
    if (!query.trim()) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchNpm(query, 25);
        if (!cancelled) setHits(results);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query]);

  const targetLabel = useMemo(() => {
    switch (target) {
      case "devDependencies":
        return "dev dependency";
      case "peerDependencies":
        return "peer dependency";
      default:
        return "dependency";
    }
  }, [target]);

  const installFlags = (pm: PackageManagerId): string[] => {
    if (target !== "devDependencies") return [];
    // pnpm / bun favor `-D`; npm / yarn favor `--save-dev`. Both forms
    // are accepted by all four PMs in modern releases, but we use the
    // canonical one per PM for cleaner CLI output.
    if (pm === "pnpm" || pm === "bun") return ["-D"];
    return ["--save-dev"];
  };

  const handleInstall = async (hit: NpmSearchHit) => {
    if (!selectedPm) {
      setError("No package manager selected.");
      return;
    }
    if (target === "peerDependencies") {
      // No install — the form editor adds the entry directly. We just
      // surface success and let the caller handle state.
      onInstalled(hit.name, `^${hit.version}`);
      onClose();
      return;
    }
    setInstalling(hit.name);
    setError(null);
    try {
      const args = [installVerb(), hit.name, ...installFlags(selectedPm)];
      await invoke("execute_command", {
        command: selectedPm,
        args,
        cwd: rootPath,
      });
      onInstalled(hit.name, `^${hit.version}`);
      onClose();
    } catch (err) {
      logger.error("[npm install] failed:", err);
      setError(`Install failed: ${String(err)}`);
    } finally {
      setInstalling(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="npm-installer-title"
        className="w-full max-w-2xl bg-[#0a0a0a] border border-[#1f1f1f] rounded-2xl shadow-2xl overflow-hidden"
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a]">
          <div>
            <h2 id="npm-installer-title" className="text-[14px] font-semibold text-white">
              Add {targetLabel}
            </h2>
            <p className="text-[11px] text-[#666] mt-0.5">
              Search the npm registry and install with your project&apos;s package manager.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#666] hover:text-white rounded transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]"
                aria-hidden
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. zod, react-hook-form, drizzle-orm"
                className="w-full bg-[#0e0e0e] border border-[#1a1a1a] rounded-lg pl-9 pr-3 py-2 text-[12px] text-white focus:border-blue-500/50 outline-none transition-colors"
              />
            </div>
            <select
              value={selectedPm ?? ""}
              onChange={(e) => setSelectedPm((e.target.value || null) as PackageManagerId | null)}
              className="bg-[#0e0e0e] border border-[#1a1a1a] rounded-lg px-3 py-2 text-[12px] text-white focus:border-blue-500/50 outline-none transition-colors"
            >
              {pms.length === 0 && <option value="">Detecting…</option>}
              {pms.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.id}
                  {p.detectedFromLockfile ? " ★" : ""}
                  {!p.available ? " (not installed)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="border border-[#1a1a1a] rounded-xl bg-[#0e0e0e] max-h-[420px] overflow-auto">
            {searching && (
              <div className="px-4 py-3 text-[11px] text-[#666] flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" />
                Searching npm…
              </div>
            )}
            {!searching && query && hits.length === 0 && (
              <div className="px-4 py-6 text-[11px] text-[#555] italic text-center">
                No packages found.
              </div>
            )}
            {!searching && !query && (
              <div className="px-4 py-6 text-[11px] text-[#555] italic text-center">
                Type to search the npm registry.
              </div>
            )}
            {hits.map((hit) => (
              <div
                key={hit.name}
                className="flex items-start gap-3 px-4 py-3 border-b border-[#161616] last:border-b-0 hover:bg-white/5 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-[#141414] border border-[#1f1f1f] flex items-center justify-center shrink-0">
                  <Package size={14} className="text-[#888]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] text-white truncate">
                      {hit.name}
                    </span>
                    <span className="font-mono text-[10px] text-[#666]">
                      {hit.version}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#888] mt-0.5 line-clamp-2">
                    {hit.description || "(no description)"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleInstall(hit)}
                  disabled={installing !== null || !selectedPm}
                  className="px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {installing === hit.name ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Download size={12} strokeWidth={1.8} />
                  )}
                  Install
                </button>
              </div>
            ))}
          </div>

          {error && (
            <div className="text-[11px] text-red-300/85 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2 font-mono">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NpmInstallerModal;
