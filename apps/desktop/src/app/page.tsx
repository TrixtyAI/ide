"use client";

import React, { useEffect } from "react";
import ActivityBar from "@/components/ActivityBar";
import LeftSidebarSlot from "@/components/slots/LeftSidebarSlot";
import EditorArea from "@/components/EditorArea";
import WelcomeScreen from "@/components/WelcomeScreen";
import RightPanelSlot from "@/components/slots/RightPanelSlot";
import BottomPanel from "@/components/BottomPanel";
import TitleBar from "@/components/TitleBar";
import SettingsView from "@/components/SettingsView";
import UpdaterDialog from "@/components/UpdaterDialog";
import OnboardingWizard from "@/components/OnboardingWizard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useApp } from "@/context/AppContext";
import { PluginManager } from "@/api/PluginManager";

export default function Home() {
  const {
    isRightPanelOpen,
    setRightPanelOpen,
    isSidebarOpen,
    setSidebarOpen,
    setActiveSidebarTab,
    isBottomPanelOpen,
    setBottomPanelOpen,
    openFiles,
    openFile,
    handleOpenFolder,
    saveCurrentFile,
    setSettingsOpen,
    isSettingsOpen,
  } = useApp();

  useEffect(() => {
    PluginManager.bootstrap();
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const key = e.key.toLowerCase();

      // Ctrl+B — Toggle sidebar
      if (ctrl && !shift && key === "b") {
        e.preventDefault();
        setSidebarOpen(!isSidebarOpen);
        return;
      }

      // Ctrl+J or Ctrl+` — Toggle terminal/bottom panel
      if (ctrl && !shift && (key === "j" || key === "`")) {
        e.preventDefault();
        setBottomPanelOpen(!isBottomPanelOpen);
        return;
      }

      // Ctrl+L — Toggle AI panel
      if (ctrl && !shift && key === "l") {
        e.preventDefault();
        setRightPanelOpen(!isRightPanelOpen);
        return;
      }

      // Ctrl+S — Save current file
      if (ctrl && !shift && key === "s") {
        e.preventDefault();
        saveCurrentFile();
        return;
      }

      // Ctrl+O — Open folder
      if (ctrl && !shift && key === "o") {
        e.preventDefault();
        handleOpenFolder();
        return;
      }

      // Ctrl+Shift+E — Focus explorer
      if (ctrl && shift && key === "e") {
        e.preventDefault();
        setActiveSidebarTab("explorer");
        setSidebarOpen(true);
        return;
      }

      // Ctrl+Shift+F — Focus search
      if (ctrl && shift && key === "f") {
        e.preventDefault();
        setActiveSidebarTab("search");
        setSidebarOpen(true);
        return;
      }

      // Ctrl+Shift+G — Focus git
      if (ctrl && shift && key === "g") {
        e.preventDefault();
        setActiveSidebarTab("git");
        setSidebarOpen(true);
        return;
      }

      // Ctrl+Shift+X — Open extensions
      if (ctrl && shift && key === "x") {
        e.preventDefault();
        openFile("virtual://extensions", "Extensions", "", "virtual");
        return;
      }

      // Ctrl+, — Open settings
      if (ctrl && key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isSidebarOpen,
    isRightPanelOpen,
    isBottomPanelOpen,
    setSidebarOpen,
    setRightPanelOpen,
    setBottomPanelOpen,
    setActiveSidebarTab,
    saveCurrentFile,
    handleOpenFolder,
    openFile,
    setSettingsOpen,
    isSettingsOpen,
  ]);

  const { systemSettings, isInitialLoadComplete } = useApp();

  if (!isInitialLoadComplete) {
    return <div className="bg-[#0a0a0a] w-screen h-screen" />;
  }

  if (!systemSettings.hasCompletedOnboarding) {
    return <OnboardingWizard />;
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0a0a0a] text-[#999] font-sans">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Activity Bar — fixed 48px */}
        <ActivityBar />

        {/* Sidebar Slot — conditionally rendered */}
        {isSidebarOpen && (
          <div className="h-full border-r border-[#1a1a1a]" style={{ width: 260 }}>
            <LeftSidebarSlot />
          </div>
        )}

        {/* Center area: editor on top, terminal on bottom */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {/* Editor / Welcome — takes remaining space */}
          <div className="flex-1 overflow-hidden bg-[#111]">
            <ErrorBoundary name="Editor Area">
              {openFiles.length > 0 ? (
                <EditorArea />
              ) : (
                <WelcomeScreen />
              )}
            </ErrorBoundary>
          </div>

          {/* Bottom Panel (Terminal / Ports) — fixed height at bottom */}
          {isBottomPanelOpen && (
            <div className="h-[300px] shrink-0">
              <ErrorBoundary name="Bottom Panel">
                <BottomPanel />
              </ErrorBoundary>
            </div>
          )}
        </div>

        {/* Right Panel (AI) */}
        {isRightPanelOpen && (
          <div className="w-[380px] shrink-0 h-full border-l border-[#1a1a1a]">
            <ErrorBoundary name="AI Panel">
              <RightPanelSlot />
            </ErrorBoundary>
          </div>
        )}
      </div>

      <SettingsView />

      {/* Updater notification — checks on mount, shows toast when update is available */}
      <UpdaterDialog />
    </div>
  );
}
