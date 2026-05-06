

import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { lazy } from "react";
import ActivityBar from "@/components/ActivityBar";
import LeftSidebarSlot from "@/components/slots/LeftSidebarSlot";
import WelcomeScreen from "@/components/WelcomeScreen";
import TitleBar from "@/components/TitleBar";
import StatusBar from "@/components/StatusBar";
import UpdaterDialog from "@/components/UpdaterDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useUI } from "@/context/UIContext";
import { useFiles } from "@/context/FilesContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useSettings } from "@/context/SettingsContext";
import { useReview, isReviewerEligible } from "@/context/ReviewContext";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useFloatingDockTracker } from "@/hooks/useFloatingDockTracker";
import { PluginManager } from "@/api/PluginManager";
import {
  BOTTOM_PANEL_VIEW_ID,
  floatingWindowRegistry,
} from "@/api/floatingWindowRegistry";
import { Terminal as TerminalIcon } from "lucide-react";
import { useL10n } from "@/hooks/useL10n";
import { useDiscordRPC } from "@/hooks/useDiscordRPC";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useDefaultLayout, type LayoutStorage } from "react-resizable-panels";

// `useDefaultLayout` defaults its `storage` prop to the global
// `localStorage` when none is provided, which throws ReferenceError in
// Node (Next 16 prerender of `output: 'export'`). Provide a noop fallback
// for SSR; the browser swap-in happens on first client render.
const NOOP_LAYOUT_STORAGE: LayoutStorage = {
  getItem: () => null,
  setItem: () => undefined,
};

// Code-split heavy panels so Monaco, xterm, Marketplace, AI chat, and the
// Settings modal aren't downloaded until the user actually opens them.
const EditorArea = lazy(() => import("@/components/EditorArea"));
const BottomPanel = lazy(() => import("@/components/BottomPanel"));
const RightPanelSlot = lazy(() => import("@/components/slots/RightPanelSlot"));
// The Reviewer pulls in Monaco's DiffEditor through ToolApprovalPanel, so
// keep it off the boot path. It only mounts when a destructive tool
// approval is pending and the viewport has room, which is rare enough that
// async-loading is an obvious win.
const ReviewerPanel = lazy(() => import("@/components/ReviewerPanel"));
const SettingsView = lazy(() => import("@/components/SettingsView"));
// Onboarding only renders during first-run and pulls ~50 KB of framer-motion
// behind it. Dynamic-load it so returning users never pay for the module.
const OnboardingWizard = lazy(() => import("@/components/OnboardingWizard"));

export default function Home() {
  const {
    isRightPanelOpen,
    setRightPanelOpen,
    isSidebarOpen,
    setSidebarOpen,
    setActiveSidebarTab,
    isBottomPanelOpen,
    setBottomPanelOpen,
    setSettingsOpen,
    isSettingsOpen,
    isZenMode,
    setZenMode,
    toggleZenMode,
  } = useUI();

  useDiscordRPC();

  const {
    openFiles,
    openFile,
    currentFile,
    setCurrentFile,
    closeFile,
    closeSaved,
    closeAll,
    saveCurrentFile,
  } = useFiles();
  const { handleOpenFolder } = useWorkspace();

  // Cmd / Ctrl+Shift+N — open another workspace in a new TrixtyIDE
  // process. Two windows = two separate processes, so each gets its
  // own Rust state, terminals, AI sessions, and store file. We don't
  // try to share anything between the instances on purpose; the
  // existing `--path` CLI flag is the contract.
  const openInNewWindow = React.useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open Folder in New Window",
      });
      if (selected && typeof selected === "string") {
        const { safeInvoke } = await import("@/api/tauri");
        await safeInvoke("spawn_workspace_instance", { path: selected });
      }
    } catch (err) {
      // Best-effort logging; failing to spawn is recoverable (the
      // current window stays usable).
      const { logger } = await import("@/lib/logger");
      logger.warn("[multi-instance] spawn failed:", err);
    }
  }, []);

  // Subscribe to the floating-window registry so the bottom panel
  // re-renders when it detaches / re-docks. We can't gate on it
  // earlier (e.g. by hiding the whole `<ResizablePanel>`) without
  // breaking the layout-preset flow that depends on the panel's
  // sizing slot existing — so we keep the slot and swap its content.
  const bottomPanelDetached = useSyncExternalStore(
    floatingWindowRegistry.subscribe,
    () => floatingWindowRegistry.isDetached(BOTTOM_PANEL_VIEW_ID),
    () => false,
  );

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
        if (pending.leader === "K" && key === "z") {
          // Ctrl+K Z — Toggle Zen Mode (parity with VSCode).
          e.preventDefault();
          toggleZenMode();
          return;
        }
        // Unknown follow-up — drop the chord and fall through so the key
        // reaches whoever was going to handle it.
      } else if (pending && Date.now() >= pending.expires) {
        pendingChordRef.current = null;
      }

      // Escape — exit Zen Mode if active. Falls through otherwise so
      // other Escape consumers (modals, overlays) keep their handler.
      if (isGlobalEscape && isZenMode) {
        e.preventDefault();
        setZenMode(false);
        return;
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

      // Ctrl+Shift+N — Open another workspace in a new window. Each
      // window is a fresh process with its own state, so two repos
      // can be open side-by-side without context switching.
      if (ctrl && shift && key === "n") {
        e.preventDefault();
        void openInNewWindow();
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
    openInNewWindow,
    openFile,
    setSettingsOpen,
    isSettingsOpen,
    currentFile,
    openFiles,
    setCurrentFile,
    closeFile,
    closeSaved,
    closeAll,
    isZenMode,
    setZenMode,
    toggleZenMode,
  ]);

  const { systemSettings, isInitialLoadComplete } = useSettings();

  // Persist horizontal layout. `panelIds` MUST match the Panels rendered
  // at Group mount-time (v4 requirement), so we recompute the live id list
  // from the open/closed UI flags. The Reviewer column is intentionally
  // excluded — it is a transient destructive-tool approval surface and
  // shouldn't influence the persisted main layout.
  const layoutPanelIds = React.useMemo(() => {
    const ids: string[] = [];
    if (isSidebarOpen) ids.push("sidebar");
    ids.push("center");
    if (isRightPanelOpen) ids.push("right-panel");
    return ids;
  }, [isSidebarOpen, isRightPanelOpen]);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    // `.v3` invalidates earlier dev-test layouts that were saved while
    // numeric size props were being misinterpreted as pixels.
    id: "trixty.layout.main-h.v3",
    panelIds: layoutPanelIds,
    storage: typeof window !== "undefined" ? window.localStorage : NOOP_LAYOUT_STORAGE,
  });

  // Single drag-tracker for redock UX, shared by left + right slots.
  const { overlayViewId } = useFloatingDockTracker();

  // Defer panel unmount on drag-to-zero until pointerup. Unmounting the
  // sidebar/right/bottom Panel mid-drag detaches the Separator element
  // from the DOM while react-resizable-panels still holds a pointer
  // capture on it; the lib then crashes with `setPointerCapture
  // InvalidStateError` and a follow-up `toFixed of undefined` from its
  // layout math. Collecting the requested closes here and applying them
  // on pointerup keeps the Separator alive for the duration of the drag.
  const pendingCloseRef = useRef<Set<"sidebar" | "right" | "bottom">>(new Set());
  useEffect(() => {
    const handlePointerUp = () => {
      if (pendingCloseRef.current.size === 0) return;
      const pending = pendingCloseRef.current;
      if (pending.has("sidebar")) setSidebarOpen(false);
      if (pending.has("right")) setRightPanelOpen(false);
      if (pending.has("bottom")) setBottomPanelOpen(false);
      pending.clear();
    };
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    return () => {
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [setSidebarOpen, setRightPanelOpen, setBottomPanelOpen]);

  // Vertical (editor / bottom panel) layout — separate persistence so it
  // does not interact with the horizontal sidebar/right toggles. The bottom
  // panel id is only listed when it is currently mounted (lib requirement).
  const verticalPanelIds = React.useMemo(() => {
    const ids: string[] = ["editor"];
    if (isBottomPanelOpen) ids.push("bottom");
    return ids;
  }, [isBottomPanelOpen]);
  const {
    defaultLayout: verticalDefaultLayout,
    onLayoutChanged: onVerticalLayoutChanged,
  } = useDefaultLayout({
    id: "trixty.layout.center-v.v1",
    panelIds: verticalPanelIds,
    storage: typeof window !== "undefined" ? window.localStorage : NOOP_LAYOUT_STORAGE,
  });

  if (!isInitialLoadComplete) {
    return <div className="bg-surface-0 w-screen h-screen" />;
  }

  if (!systemSettings.hasCompletedOnboarding) {
    return <OnboardingWizard />;
  }

  // Zen Mode: hide everything except editor + status bar + title bar. Esc exits.
  if (isZenMode) {
    return (
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-surface-0 text-[#999] font-sans">
        <TitleBar />
        <div className="flex-1 overflow-hidden bg-surface-2 min-h-0">
          <ErrorBoundary name="Editor Area (Zen)">
            {openFiles.length > 0 ? <EditorArea /> : <WelcomeScreen />}
          </ErrorBoundary>
        </div>
        <StatusBar />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-surface-0 text-[#999] font-sans">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Activity Bar — fixed 48px, sits outside the resizable group so
            its width never participates in the layout math. */}
        <ActivityBar />

        {/* Horizontal resizable group: sidebar | center | right (| reviewer).
            Sizes persist across sessions via `autoSaveId` (localStorage).
            Conditionally-mounted panels keep their `id` so react-resizable-
            panels can restore the correct slice when they reappear. */}
        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
          className="flex-1"
        >
          {isSidebarOpen && (
            <>
              <ResizablePanel
                id="sidebar"
                defaultSize="18%"
                minSize="10%"
                maxSize="40%"
                collapsible
                collapsedSize="0%"
                // v4 has no `onCollapse` — detect via `onResize` and flip
                // the open flag when the panel reaches its collapsed size
                // so the slot unmounts (matches the toggle / keyboard
                // shortcut UX).
                onResize={(panelSize) => {
                  if (panelSize.asPercentage === 0) {
                    pendingCloseRef.current.add("sidebar");
                  }
                }}
              >
                <div className="h-full border-r border-border-subtle">
                  <LeftSidebarSlot overlayViewId={overlayViewId} />
                </div>
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}

          {/* v4 parses bare numbers as pixels (see `bt()` in
              react-resizable-panels), so percent values MUST be passed as
              strings with the `%` suffix. */}
          <ResizablePanel id="center" defaultSize="58%" minSize="30%">
            <ResizablePanelGroup
              orientation="vertical"
              defaultLayout={verticalDefaultLayout}
              onLayoutChanged={onVerticalLayoutChanged}
              className="h-full"
            >
              <ResizablePanel
                id="editor"
                defaultSize="70%"
                minSize="20%"
              >
                <div className="h-full overflow-hidden bg-surface-2">
                  <ErrorBoundary name="Editor Area">
                    {openFiles.length > 0 ? (
                      <EditorArea />
                    ) : (
                      <WelcomeScreen />
                    )}
                  </ErrorBoundary>
                </div>
              </ResizablePanel>
              {isBottomPanelOpen && (
                <>
                  <ResizableHandle />
                  <ResizablePanel
                    id="bottom"
                    defaultSize="30%"
                    minSize="10%"
                    maxSize="70%"
                    collapsible
                    collapsedSize="0%"
                    onResize={(panelSize) => {
                      if (panelSize.asPercentage === 0) {
                        pendingCloseRef.current.add("bottom");
                      }
                    }}
                  >
                    <div className="h-full overflow-hidden">
                      <ErrorBoundary name="Bottom Panel">
                        {bottomPanelDetached ? (
                          <BottomPanelDetachedPlaceholder />
                        ) : (
                          <BottomPanel />
                        )}
                      </ErrorBoundary>
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {isRightPanelOpen && (
            <>
              <ResizableHandle />
              <ResizablePanel
                id="right-panel"
                defaultSize="24%"
                minSize="14%"
                maxSize="45%"
                collapsible
                collapsedSize="0%"
                onResize={(panelSize) => {
                  if (panelSize.asPercentage === 0) {
                    pendingCloseRef.current.add("right");
                  }
                }}
              >
                <div className="h-full border-l border-border-subtle">
                  <ErrorBoundary name="AI Panel">
                    <RightPanelSlot overlayViewId={overlayViewId} />
                  </ErrorBoundary>
                </div>
              </ResizablePanel>
            </>
          )}

          {/* Reviewer Panel — only mounts when there's a destructive tool
              approval pending AND the viewport is wide enough to spare the
              column. On narrower windows the AI chat falls back to the inline
              approval dialog so the approval UX never becomes unreachable. */}
          <ReviewerColumn />
        </ResizablePanelGroup>
      </div>

      {/* Settings is a modal: only mount it when open so `next/dynamic` can
          actually keep its chunk off the boot path. Referencing the component
          unconditionally would execute the dynamic import on first render. */}
      {isSettingsOpen && <SettingsView />}

      {/* Updater notification — checks on mount, shows toast when update is available */}
      <UpdaterDialog />

      <StatusBar />
    </div>
  );
}

// Rendered in the bottom panel slot while the panel is detached into a
// floating window. Mirrors the placeholder pattern the right-panel
// slots use — keeps the column reserved so re-dock fills back into the
// same place, and offers a one-click "Dock back" affordance that
// drives the registry directly.
function BottomPanelDetachedPlaceholder() {
  const { t } = useL10n();
  return (
    <div className="h-full bg-[#0e0e0e] flex flex-col items-center justify-center text-[#777] text-[11px] gap-3 p-6 text-center">
      <TerminalIcon size={20} strokeWidth={1.5} className="text-[#444]" />
      <span>
        {t("panel.view.in_floating_window", {
          name: t("panel.bottom.terminal_tabs", { defaultValue: "Terminal" }),
        })}
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => void floatingWindowRegistry.focus(BOTTOM_PANEL_VIEW_ID)}
          className="px-3 py-1.5 text-[11px] bg-white/5 hover:bg-white/10 text-white rounded border border-white/10 transition-colors"
        >
          {t("panel.view.bring_to_front")}
        </button>
        <button
          onClick={() => void floatingWindowRegistry.redock(BOTTOM_PANEL_VIEW_ID)}
          className="px-3 py-1.5 text-[11px] bg-blue-500/15 hover:bg-blue-500/25 text-blue-200 rounded border border-blue-500/30 transition-colors"
        >
          {t("panel.view.dock_back")}
        </button>
      </div>
    </div>
  );
}

// Factored out so the `useReview` / `useMediaQuery` subscriptions only drive
// re-renders of this column, not the whole page tree. Render-noops when there
// is no destructive tool to approve, or when the viewport is too narrow to
// fit both the AI panel and the Reviewer without crushing the editor.
function ReviewerColumn() {
  const { pendingTool } = useReview();
  const canDockReviewer = useMediaQuery("(min-width: 1100px)");
  if (!pendingTool || !isReviewerEligible(pendingTool.name) || !canDockReviewer) {
    return null;
  }
  return (
    <>
      <ResizableHandle />
      <ResizablePanel
        id="reviewer"
        defaultSize="30%"
        minSize="20%"
        maxSize="55%"
      >
        <div className="h-full">
          <ErrorBoundary name="Reviewer Panel">
            <ReviewerPanel />
          </ErrorBoundary>
        </div>
      </ResizablePanel>
    </>
  );
}
