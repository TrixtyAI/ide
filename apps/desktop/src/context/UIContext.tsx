"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { trixtyStore } from "@/api/store";
import { logger } from "@/lib/logger";

const PANELS_STORE_KEY = "trixty.ui.panels";

interface PanelsSnapshot {
  sidebar: boolean;
  right: boolean;
  bottom: boolean;
  activeSidebarTab: string;
}

const PANELS_DEFAULTS: PanelsSnapshot = {
  sidebar: false,
  right: false,
  bottom: false,
  activeSidebarTab: "explorer",
};

interface UIContextType {
  activeSidebarTab: string;
  isSidebarOpen: boolean;
  isRightPanelOpen: boolean;
  isBottomPanelOpen: boolean;
  isSettingsOpen: boolean;
  isZenMode: boolean;
  terminalPath: string | null;
  setActiveSidebarTab: (tab: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setBottomPanelOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setZenMode: (on: boolean) => void;
  toggleZenMode: () => void;
  openTerminal: (path: string) => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const UIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeSidebarTab, setActiveSidebarTab] = useState(PANELS_DEFAULTS.activeSidebarTab);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);
  const [terminalPath, setTerminalPath] = useState<string | null>(null);

  const toggleZenMode = useCallback(() => setIsZenMode((v) => !v), []);

  // Hydrate panel open/closed flags from persistent store on mount, then
  // start saving on every change. The `hydrated` ref gates the save effect
  // so the default `false` values don't overwrite the user's last layout
  // before we have a chance to load it.
  const hydratedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await trixtyStore.get<PanelsSnapshot>(
          PANELS_STORE_KEY,
          PANELS_DEFAULTS,
        );
        if (cancelled) return;
        setIsSidebarOpen(snapshot.sidebar);
        setIsRightPanelOpen(snapshot.right);
        setIsBottomPanelOpen(snapshot.bottom);
        if (snapshot.activeSidebarTab) {
          setActiveSidebarTab(snapshot.activeSidebarTab);
        }
      } catch (err) {
        logger.warn("[UIContext] failed to hydrate panel state:", err);
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const snapshot: PanelsSnapshot = {
      sidebar: isSidebarOpen,
      right: isRightPanelOpen,
      bottom: isBottomPanelOpen,
      activeSidebarTab,
    };
    void trixtyStore.set(PANELS_STORE_KEY, snapshot).catch((err) => {
      logger.warn("[UIContext] failed to persist panel state:", err);
    });
  }, [isSidebarOpen, isRightPanelOpen, isBottomPanelOpen, activeSidebarTab]);

  // Global: suppress the native context menu so the IDE's own menus win.
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  const openTerminal = useCallback((path: string) => {
    setTerminalPath((prev) => (prev === path ? prev : path)); // no-op if same path
    setIsBottomPanelOpen(true);
  }, []);

  const value = useMemo(() => ({
    activeSidebarTab,
    isSidebarOpen,
    isRightPanelOpen,
    isBottomPanelOpen,
    isSettingsOpen,
    isZenMode,
    terminalPath,
    setActiveSidebarTab,
    setSidebarOpen: setIsSidebarOpen,
    setRightPanelOpen: setIsRightPanelOpen,
    setBottomPanelOpen: setIsBottomPanelOpen,
    setSettingsOpen: setIsSettingsOpen,
    setZenMode: setIsZenMode,
    toggleZenMode,
    openTerminal,
  }), [
    activeSidebarTab,
    isSidebarOpen,
    isRightPanelOpen,
    isBottomPanelOpen,
    isSettingsOpen,
    isZenMode,
    terminalPath,
    openTerminal,
    toggleZenMode,
  ]);

  return (
    <UIContext.Provider value={value}>
      {children}
    </UIContext.Provider>
  );
};

export const useUI = () => {
  const context = useContext(UIContext);
  if (!context) throw new Error("useUI must be used within a UIProvider");
  return context;
};
