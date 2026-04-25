"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";

interface UIContextType {
  activeSidebarTab: string;
  isSidebarOpen: boolean;
  isRightPanelOpen: boolean;
  isBottomPanelOpen: boolean;
  isSettingsOpen: boolean;
  terminalPath: string | null;
  setActiveSidebarTab: (tab: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setBottomPanelOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  openTerminal: (path: string) => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const UIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeSidebarTab, setActiveSidebarTab] = useState("explorer");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [terminalPath, setTerminalPath] = useState<string | null>(null);

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
    terminalPath,
    setActiveSidebarTab,
    setSidebarOpen: setIsSidebarOpen,
    setRightPanelOpen: setIsRightPanelOpen,
    setBottomPanelOpen: setIsBottomPanelOpen,
    setSettingsOpen: setIsSettingsOpen,
    openTerminal,
  }), [
    activeSidebarTab,
    isSidebarOpen,
    isRightPanelOpen,
    isBottomPanelOpen,
    isSettingsOpen,
    terminalPath,
    openTerminal,
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
