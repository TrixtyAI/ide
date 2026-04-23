"use client";

import React, { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import ActivityBar from "@/components/ActivityBar";
import LeftSidebarSlot from "@/components/slots/LeftSidebarSlot";
import WelcomeScreen from "@/components/WelcomeScreen";
import TitleBar from "@/components/TitleBar";
import UpdaterDialog from "@/components/UpdaterDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useApp } from "@/context/AppContext";
import { PluginManager } from "@/api/PluginManager";

// Code-split heavy panels so Monaco, xterm, Marketplace, AI chat, and the
// Settings modal aren't downloaded until the user actually opens them.
// `ssr: false` skips the RSC attempt — this app is always client-rendered
// inside Tauri, and several of these components touch `window` at module
// scope.
const EditorArea = dynamic(() => import("@/components/EditorArea"), { ssr: false });
const BottomPanel = dynamic(() => import("@/components/BottomPanel"), { ssr: false });
const RightPanelSlot = dynamic(() => import("@/components/slots/RightPanelSlot"), { ssr: false });
const SettingsView = dynamic(() => import("@/components/SettingsView"), { ssr: false });
// Onboarding only renders during first-run and pulls ~50 KB of framer-motion
// behind it. Dynamic-load it so returning users never pay for the module.
const OnboardingWizard = dynamic(() => import("@/components/OnboardingWizard"), { ssr: false });

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
    currentFile,
    setCurrentFile,
    closeFile,
    closeSaved,
    closeAll,
    handleOpenFolder,
    saveCurrentFile,
    setSettingsOpen,
    isSettingsOpen,
  } = useApp();

  // Tracks a pending `Ctrl+K` leader for two-step chords (`Ctrl+K U`,
  // `Ctrl+K W`). The TTL matches the VS Code default: if the second key
  // doesn't arrive in time, treat it as a mistyped `Ctrl+K` and let any
  // other handler (Monaco's, mostly) have the next keystroke back. Stored
  // on a ref so the handler closure doesn't re-subscribe on every chord.
  const pendingChordRef = useRef<{ leader: "K"; expires: number } | null>(null);
  const CHORD_TTL_MS = 1500;

  useEffect(() => {
    PluginManager.bootstrap();
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    // Returns true when the keydown originated inside an editable control
    // (input, textarea, contenteditable). Container-level opt-in via
    // `data-allow-global-shortcuts="true"` lets a surface that owns its own
    // save/submit semantics (Monaco today) keep receiving app shortcuts
    // even when focus is on an internal input.
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.closest<HTMLElement>('[data-allow-global-shortcuts="true"]')) {
        return false;
      }
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const key = e.key.toLowerCase();

      // Before doing any app-shortcut work, bail out when the user is typing
      // into a regular input/textarea/contenteditable. Escape and F-keys are
      // universally "exit / help" chords and must reach their handlers even
      // from inside a field, and `Ctrl+Shift+P` is reserved for the future
      // command palette. Everything else falls through to the platform or
      // the input itself, so Ctrl+S no longer saves the active file while
      // the AI-chat textarea is focused.
      const isGlobalEscape = key === "escape";
      const isFKey = /^f\d+$/.test(key);
      const isCommandPalette = ctrl && shift && key === "p";
      if (
        isEditableTarget(e.target) &&
        !isGlobalEscape &&
        !isFKey &&
        !isCommandPalette
      ) {
        return;
      }

      // Resolve a pending `Ctrl+K` chord first. The follow-up key is a
      // plain letter (no modifier) — if the user held Ctrl through the
      // second press we treat it as "they gave up on the chord" and fall
      // through so their intended non-chord shortcut still fires.
      const pending = pendingChordRef.current;
      if (pending && Date.now() < pending.expires && !ctrl) {
        pendingChordRef.current = null;
        if (pending.leader === "K" && key === "u") {
          e.preventDefault();
          closeSaved();
          return;
        }
        if (pending.leader === "K" && key === "w") {
          e.preventDefault();
          closeAll();
          return;
        }
        // Unknown follow-up — drop the chord and fall through so the key
        // reaches whoever was going to handle it.
      } else if (pending && Date.now() >= pending.expires) {
        pendingChordRef.current = null;
      }

      // Ctrl+W / Ctrl+F4 — Close current tab. `Ctrl+F4` is the combo the
      // TabBar context menu already advertises at TabBar.tsx:44; `Ctrl+W`
      // is the more widely expected one and is cheap to offer alongside.
      if (ctrl && !shift && (key === "w" || key === "f4")) {
        e.preventDefault();
        if (currentFile) closeFile(currentFile.path);
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab — Cycle forward / backward through open
      // tabs with wrap-around. Ignores the MRU ordering VS Code uses; a
      // straight list walk is more predictable without a history stack.
      if (ctrl && key === "tab") {
        e.preventDefault();
        if (openFiles.length < 2 || !currentFile) return;
        const idx = openFiles.findIndex((f) => f.path === currentFile.path);
        if (idx === -1) return;
        const len = openFiles.length;
        const next = shift
          ? openFiles[(idx - 1 + len) % len]
          : openFiles[(idx + 1) % len];
        setCurrentFile(next);
        return;
      }

      // Ctrl+1..9 — Jump to tab N. `Ctrl+9` is "last tab" (VS Code
      // semantics) so the combo keeps working once the user has more
      // than nine files open.
      if (ctrl && !shift && key.length === 1 && key >= "1" && key <= "9") {
        e.preventDefault();
        if (openFiles.length === 0) return;
        const n = parseInt(key, 10);
        const idx = n === 9 ? openFiles.length - 1 : Math.min(n - 1, openFiles.length - 1);
        setCurrentFile(openFiles[idx]);
        return;
      }

      // Ctrl+K — Start a chord. Intentionally no `preventDefault`: the
      // key itself is a no-op, and swallowing it would break any future
      // Monaco/Tauri handler that wants to use plain `Ctrl+K`.
      if (ctrl && !shift && key === "k") {
        pendingChordRef.current = { leader: "K", expires: Date.now() + CHORD_TTL_MS };
        return;
      }

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
    currentFile,
    openFiles,
    setCurrentFile,
    closeFile,
    closeSaved,
    closeAll,
  ]);

  const { systemSettings, isInitialLoadComplete } = useApp();

  if (!isInitialLoadComplete) {
    return <div className="bg-surface-0 w-screen h-screen" />;
  }

  if (!systemSettings.hasCompletedOnboarding) {
    return <OnboardingWizard />;
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-surface-0 text-[#999] font-sans">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Activity Bar — fixed 48px */}
        <ActivityBar />

        {/* Sidebar Slot — conditionally rendered */}
        {isSidebarOpen && (
          <div className="h-full border-r border-border-subtle" style={{ width: 260 }}>
            <LeftSidebarSlot />
          </div>
        )}

        {/* Center area: editor on top, terminal on bottom */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {/* Editor / Welcome — takes remaining space */}
          <div className="flex-1 overflow-hidden bg-surface-2">
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
          <div className="w-[380px] shrink-0 h-full border-l border-border-subtle">
            <ErrorBoundary name="AI Panel">
              <RightPanelSlot />
            </ErrorBoundary>
          </div>
        )}
      </div>

      {/* Settings is a modal: only mount it when open so `next/dynamic` can
          actually keep its chunk off the boot path. Referencing the component
          unconditionally would execute the dynamic import on first render. */}
      {isSettingsOpen && <SettingsView />}

      {/* Updater notification — checks on mount, shows toast when update is available */}
      <UpdaterDialog />
    </div>
  );
}
