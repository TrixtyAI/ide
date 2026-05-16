"use client";

import React, { createContext, useContext, useState, useCallback, useMemo, useRef } from "react";
import { safeInvoke as invoke } from "@/api/tauri";
import { logger } from "@/lib/logger";

export interface ExtensionManifest {
  name: string;
  version: string;
  description?: string;
  displayName?: string;
  author?: string;
  publisher?: string;
  release?: {
    url: string;
  };
  categories?: string[];
  keywords?: string[];
  icon?: string;
  main?: string;
  engines?: {
    trixty: string;
  };
  contributes?: Record<string, unknown>; // We keep unknown here for complex nested structures, but we could refine later
}

export interface MarketplaceEntry {
  id: string;
  repository?: string;
  branch?: string;
  data?: string;
  path?: string;
  manifest?: ExtensionManifest;
  readme?: string; // Loaded dynamically
  stars?: number; // GitHub stargazers_count, resolved at catalog load time
}

export interface ExtensionState {
  id: string;
  isInstalled: boolean;
  isActive: boolean;
}

interface ExtensionContextType {
  catalog: MarketplaceEntry[];
  installedIds: string[];
  activeIds: string[];
  loading: boolean;
  /** Flips true the first time `refreshCatalog` begins. Lets consumers tell
   * "nothing tried yet" apart from "tried and got an empty catalog" without
   * flashing the empty-state UI before the deferred fetch kicks in. */
  hasAttemptedCatalogLoad: boolean;
  error: string | null;
  refreshCatalog: () => Promise<void>;
  installExtension: (entry: MarketplaceEntry) => Promise<void>;
  uninstallExtension: (id: string) => Promise<void>;
  updateExtension: (id: string) => Promise<void>;
  toggleActive: (id: string, active: boolean) => Promise<void>;
  fetchFile: (entry: MarketplaceEntry, fileName: string) => Promise<string>;
}

/**
 * Resolve a marketplace entry to a clone-/raw-friendly GitHub repo URL.
 *
 * Prefers the explicit `repository` field. When only `data` is provided,
 * parses the GitHub URL (`github.com/<owner>/<repo>/blob/...` or the matching
 * `raw.githubusercontent.com/<owner>/<repo>/...` form) and rebuilds
 * `https://github.com/<owner>/<repo>.git`. Returns null if the entry has no
 * resolvable GitHub origin so callers can surface a clear error instead of
 * silently passing the original `data` URL to `git clone`.
 */
export function resolveGitRepoUrl(entry: MarketplaceEntry): string | null {
  if (entry.repository) return entry.repository;
  if (!entry.data) return null;

  try {
    const u = new URL(entry.data);
    if (u.hostname !== "github.com" && u.hostname !== "raw.githubusercontent.com") {
      return null;
    }
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    const [owner, rawRepo] = segments;
    // Strip an existing `.git` so catalog entries that already point at a
    // `...repo.git/...` path don't end up producing `.git.git` and failing
    // `git clone`.
    const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo;
    if (!repo) return null;
    return `https://github.com/${owner}/${repo}.git`;
  } catch {
    return null;
  }
}

const ExtensionContext = createContext<ExtensionContextType | undefined>(undefined);

export const ExtensionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [catalog, setCatalog] = useState<MarketplaceEntry[]>([]);
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasAttemptedCatalogLoad, setHasAttemptedCatalogLoad] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against concurrent `refreshCatalog` calls. Needed because React 18
  // StrictMode remounts the marketplace view twice in development, and any
  // caller can also invoke the function from multiple code paths.
  const inFlightRef = useRef(false);

  const refreshCatalog = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setHasAttemptedCatalogLoad(true);
    setError(null);
    try {
      // The Tauri process CWD is usually apps/desktop/src-tauri, so the repo root is ../../../
      const registryUrl = "https://raw.githubusercontent.com/TrixtyAI/ide/main/registry/marketplace.json";
      const devRegistryUrl = "../../../registry/marketplace.json";

      const targetUrl = process.env.NODE_ENV === "development" ? devRegistryUrl : registryUrl;

      // 1. Fetch remote catalog raw list
      const catalogData = await invoke("get_registry_catalog", { url: targetUrl });
      const entries: MarketplaceEntry[] = catalogData.marketplace || [];

      // 2. Fetch the manifest (package.json) and GitHub stars for each entry.
      // Both requests run concurrently per entry, and allSettled is used so one
      // failure (e.g. GitHub rate limit on stars) doesn't drop the other data.
      const enrichedEntries = await Promise.all(
        entries.map(async (entry) => {
          const resolvedRepoUrl = resolveGitRepoUrl(entry) || "";
          // Both calls are silent — a missing manifest or unreachable
          // GitHub stars endpoint is normal for in-progress catalog
          // entries (e.g. example-addon stub) and we don't want them
          // surfaced as `[Tauri Invoke Error]` in the dev console.
          const [manifestResult, starsResult] = await Promise.allSettled([
            invoke(
              "fetch_extension_manifest",
              {
                repoUrl: entry.repository || "",
                branch: entry.branch || "main",
                dataUrl: entry.data,
                path: entry.path,
              },
              { silent: true },
            ),
            invoke(
              "fetch_extension_stars",
              { repoUrl: resolvedRepoUrl },
              { silent: true },
            ),
          ]);

          const manifest = manifestResult.status === "fulfilled" ? manifestResult.value : undefined;
          const stars = starsResult.status === "fulfilled" && starsResult.value != null
            ? starsResult.value
            : undefined;

          if (manifestResult.status === "rejected") {
            // Demoted to debug — the catalog tolerates entries without a
            // resolvable manifest, the UI just renders the bare entry.
            logger.debug(
              `[ExtensionContext] manifest unavailable for ${entry.id}:`,
              manifestResult.reason,
            );
          }

          return { ...entry, manifest, stars };
        })
      );

      setCatalog(enrichedEntries);

      // 3. Load installed extensions state from disk
      const installed = await invoke("get_installed_extensions");
      setInstalledIds(installed);

      // 4. Check active states in parallel so N installed extensions cost one
      // round-trip window instead of N serial awaits.
      const activeFlags = await Promise.all(
        installed.map((id) => invoke("is_extension_active", { id }))
      );
      setActiveIds(installed.filter((_, i) => activeFlags[i]));

    } catch (e) {
      setError(String(e));
      logger.error("Failed to load extensions", e);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  const installExtension = useCallback(async (entry: MarketplaceEntry) => {
    const gitUrl = resolveGitRepoUrl(entry);

    if (!gitUrl) {
      setError("Cannot install: No repository URL defined.");
      return;
    }

    try {
      await invoke("install_extension", { id: entry.id, gitUrl });
      await refreshCatalog();
    } catch (e) {
      throw new Error("Install failed: " + String(e));
    }
  }, [refreshCatalog]);

  const uninstallExtension = useCallback(async (id: string) => {
    try {
      await invoke("uninstall_extension", { id });
      await refreshCatalog();
    } catch (e) {
      throw new Error("Uninstall failed: " + String(e));
    }
  }, [refreshCatalog]);

  const updateExtension = useCallback(async (id: string) => {
    try {
      await invoke("update_extension", { id });
    } catch (e) {
      throw new Error("Update failed: " + String(e));
    }
  }, []);

  const toggleActive = useCallback(async (id: string, active: boolean) => {
    try {
      await invoke("toggle_extension_state", { id, isActive: active });
      setActiveIds((prev) =>
        active ? [...prev, id] : prev.filter((x) => x !== id)
      );
    } catch (e) {
      throw new Error("Toggle state failed: " + String(e));
    }
  }, []);

  // Memoized so MarketplaceView's DetailsView doesn't retrigger its README/CHANGELOG
  // effect on every ExtensionContext re-render.
  const fetchFile = useCallback(async (entry: MarketplaceEntry, fileName: string) => {
      const repoUrl = resolveGitRepoUrl(entry);
      if (!repoUrl) return "";
      try {
        const text = await invoke("fetch_extension_file", {
            repoUrl,
            branch: entry.branch || "main",
            path: entry.path,
            fileName,
        });
        return text;
      } catch {
         return "";
      }
  }, []);

  const value = useMemo(() => ({
    catalog,
    installedIds,
    activeIds,
    loading,
    hasAttemptedCatalogLoad,
    error,
    refreshCatalog,
    installExtension,
    uninstallExtension,
    updateExtension,
    toggleActive,
    fetchFile,
  }), [
    catalog,
    installedIds,
    activeIds,
    loading,
    hasAttemptedCatalogLoad,
    error,
    refreshCatalog,
    installExtension,
    uninstallExtension,
    updateExtension,
    toggleActive,
    fetchFile,
  ]);

  return (
    <ExtensionContext.Provider value={value}>
      {children}
    </ExtensionContext.Provider>
  );
};

export const useExtensions = () => {
  const context = useContext(ExtensionContext);
  if (context === undefined) {
    throw new Error("useExtensions must be used within an ExtensionProvider");
  }
  return context;
};
