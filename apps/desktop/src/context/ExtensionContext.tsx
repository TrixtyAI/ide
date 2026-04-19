"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { safeInvoke as invoke } from "@/api/tauri";
import { useApp } from "./AppContext"; // For rootPath or generic alerts if needed

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
  error: string | null;
  refreshCatalog: () => Promise<void>;
  installExtension: (entry: MarketplaceEntry) => Promise<void>;
  uninstallExtension: (id: string) => Promise<void>;
  updateExtension: (id: string) => Promise<void>;
  toggleActive: (id: string, active: boolean) => Promise<void>;
  fetchFile: (entry: MarketplaceEntry, fileName: string) => Promise<string>;
}

const ExtensionContext = createContext<ExtensionContextType | undefined>(undefined);

export const ExtensionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [catalog, setCatalog] = useState<MarketplaceEntry[]>([]);
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { rootPath } = useApp();

  const refreshCatalog = async () => {
    setLoading(true);
    setError(null);
    try {
      // The Tauri process CWD is usually apps/desktop/src-tauri, so the repo root is ../../../
      const registryUrl = "http://raw.githubusercontent.com/TrixtyAI/ide/main/registry/marketplace.json";
      const devRegistryUrl = "../../../registry/marketplace.json";

      // We will try devRegistryUrl, if it fails because it's a prod build, fallback to HTTP or viceversa.
      // But for local test, let's just pass devRegistryUrl directly.
      const targetUrl = process.env.NODE_ENV === "development" ? devRegistryUrl : registryUrl;

      // 1. Fetch remote catalog raw list
      const catalogData = await invoke("get_registry_catalog", { url: targetUrl });
      const entries: MarketplaceEntry[] = catalogData.marketplace || [];

      // 2. Fetch the metadata (package.json) for each to get the names, authors...
      // Doing this concurrently using Promise.all
      const enrichedEntries = await Promise.all(
        entries.map(async (entry) => {
          try {
            const manifest = await invoke("fetch_extension_manifest", {
              repoUrl: entry.repository || "",
              branch: entry.branch || "main",
              dataUrl: entry.data,
              path: entry.path
            });
            return { ...entry, manifest };
          } catch (e) {
            console.error(`Error fetching manifest for ${entry.id}`, e);
            // Return entry without manifest, UI will show generic fallback
            return entry;
          }
        })
      );

      setCatalog(enrichedEntries);

      // 3. Load installed extensions state from disk
      const installed = await invoke("get_installed_extensions");
      setInstalledIds(installed);

      // 4. Check active states
      const active: string[] = [];
      for (const id of installed) {
        const isAct = await invoke("is_extension_active", { id });
        if (isAct) active.push(id);
      }
      setActiveIds(active);

    } catch (e) {
      setError(String(e));
      console.error("Failed to load extensions", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshCatalog();
  }, []);

  const installExtension = async (entry: MarketplaceEntry) => {
    // If it's a repo-based, we pass the repo url. If they define "data" url only,
    // we could deduce repo URL or just fallback. We assume git clone for now,
    // so `repository` should exist. However, the user provided 'data' in marketplace.json.
    // Let's deduce repository if not explicitly set:
    const gitUrl = entry.repository || entry.data?.replace("/ide/blob/main/extensions/example-addon/package.json", ".git");

    if (!gitUrl) {
      setError("Cannot install: No repository URL defined.");
      return;
    }

    try {
      await invoke("install_extension", { id: entry.id, gitUrl: gitUrl });
      await refreshCatalog();
    } catch (e) {
      throw new Error("Install failed: " + String(e));
    }
  };

  const uninstallExtension = async (id: string) => {
    try {
      await invoke("uninstall_extension", { id });
      await refreshCatalog();
    } catch (e) {
      throw new Error("Uninstall failed: " + String(e));
    }
  };

  const updateExtension = async (id: string) => {
    try {
      await invoke("update_extension", { id });
    } catch (e) {
      throw new Error("Update failed: " + String(e));
    }
  };

  const toggleActive = async (id: string, active: boolean) => {
    try {
      await invoke("toggle_extension_state", { id, isActive: active });
      setActiveIds((prev) =>
        active ? [...prev, id] : prev.filter((x) => x !== id)
      );
    } catch (e) {
      throw new Error("Toggle state failed: " + String(e));
    }
  };

  const fetchFile = async (entry: MarketplaceEntry, fileName: string) => {
      try {
        const text = await invoke("fetch_extension_file", {
            repoUrl: entry.repository || entry.data?.replace("/ide/blob/main/extensions/example-addon/package.json", ".git") || "",
            branch: entry.branch || "main",
            path: entry.path,
            fileName: fileName
        });
        return text;
      } catch (e) {
         return "";
      }
  };

  return (
    <ExtensionContext.Provider value={{
      catalog,
      installedIds,
      activeIds,
      loading,
      error,
      refreshCatalog,
      installExtension,
      uninstallExtension,
      updateExtension,
      toggleActive,
      fetchFile
    }}>
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
