"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Terminal from "./Terminal";
import { Plus, X, Terminal as TerminalIcon } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";

interface TerminalTab {
  id: string;
  /** Initial cwd for this tab's PTY. Never mutated — cwd changes after
   *  spawn would require the shell to `cd` itself, which we leave to
   *  the user. */
  cwd: string | null;
}

const newSessionId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for very old browsers — good enough for a process-local
  // session id that never leaves the renderer.
  return `term-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

const BottomPanel: React.FC = () => {
  const { setBottomPanelOpen, rootPath, terminalPath } = useApp();
  const { t } = useL10n();

  // Seed with a single tab whose cwd resolves at mount time. Subsequent
  // `terminalPath` changes (user right-clicks "Open in Terminal" on a
  // folder in the explorer) open a new tab rather than respawning the
  // active one, so existing sessions aren't lost.
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [
    { id: newSessionId(), cwd: terminalPath ?? rootPath ?? null },
  ]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0].id);

  // Track the last `terminalPath` we spawned a tab for so a stable
  // `rootPath` update (or a remount) doesn't keep opening new tabs.
  const lastHandledTerminalPath = useRef<string | null>(terminalPath);

  // Reacting to an external signal (`terminalPath` is set by the explorer's
  // "Open in Terminal" action and the user has no other way to reach this
  // branch). `react-hooks/set-state-in-effect` flags state updates inside
  // effects as potentially cascading, but this fires only when the user
  // explicitly picks a folder — not on every render — so a cascade is
  // impossible. The ref guard also prevents a double-fire during StrictMode
  // re-invocation of the effect on the same `terminalPath` value.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (terminalPath && terminalPath !== lastHandledTerminalPath.current) {
      lastHandledTerminalPath.current = terminalPath;
      const id = newSessionId();
      setTabs((prev) => [...prev, { id, cwd: terminalPath }]);
      setActiveId(id);
    }
  }, [terminalPath]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const addTab = useCallback(() => {
    const id = newSessionId();
    setTabs((prev) => [...prev, { id, cwd: rootPath ?? null }]);
    setActiveId(id);
  }, [rootPath]);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length === 1) {
          // Closing the only tab closes the panel — the next open reseeds
          // a fresh tab via the initial state.
          setBottomPanelOpen(false);
          return prev;
        }
        const next = prev.filter((tab) => tab.id !== id);
        if (id === activeId) {
          const idx = prev.findIndex((tab) => tab.id === id);
          const neighbor = next[Math.min(idx, next.length - 1)];
          if (neighbor) setActiveId(neighbor.id);
        }
        return next;
      });
    },
    [activeId, setBottomPanelOpen],
  );

  const tabLabel = useCallback(
    (tab: TerminalTab, index: number) => {
      if (tab.cwd) {
        // Show just the folder name so labels don't blow up horizontally.
        const parts = tab.cwd.split(/[\\/]/).filter(Boolean);
        if (parts.length > 0) return parts[parts.length - 1];
      }
      return t("panel.bottom.terminal_tab", {
        n: String(index + 1),
        defaultValue: `Terminal ${index + 1}`,
      });
    },
    [t],
  );

  // Memoize the mounted Terminal elements so switching tabs doesn't
  // re-render every xterm instance — each is expensive to mount.
  const terminalElements = useMemo(
    () =>
      tabs.map((tab) => (
        <div
          key={tab.id}
          className={tab.id === activeId ? "block h-full" : "hidden"}
          role="tabpanel"
          id={`terminal-panel-${tab.id}`}
          aria-labelledby={`terminal-tab-${tab.id}`}
        >
          <Terminal
            sessionId={tab.id}
            cwd={tab.cwd}
            isActive={tab.id === activeId}
          />
        </div>
      )),
    [tabs, activeId],
  );

  return (
    <div className="h-full bg-[#0e0e0e] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 h-[36px] bg-[#0a0a0a] shrink-0 border-t border-[#1a1a1a]">
        <div
          className="flex items-center gap-1 h-full overflow-x-auto"
          role="tablist"
          aria-label={t("panel.bottom.terminal_tabs", {
            defaultValue: "Terminal tabs",
          })}
        >
          {tabs.map((tab, index) => {
            const isActive = tab.id === activeId;
            return (
              <div
                key={tab.id}
                className={`flex items-center h-full px-2 gap-1 text-[11px] uppercase tracking-wider shrink-0 ${
                  isActive
                    ? "text-white border-b border-white"
                    : "text-[#777] hover:text-white"
                }`}
              >
                <TerminalIcon size={12} strokeWidth={1.5} />
                <button
                  id={`terminal-tab-${tab.id}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`terminal-panel-${tab.id}`}
                  onClick={() => setActiveId(tab.id)}
                  className="font-medium max-w-[140px] truncate focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  title={tab.cwd ?? undefined}
                >
                  {tabLabel(tab, index)}
                </button>
                <button
                  onClick={() => closeTab(tab.id)}
                  aria-label={t("panel.bottom.terminal_close_tab", {
                    defaultValue: "Close terminal",
                  })}
                  className="p-0.5 rounded hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <X size={12} strokeWidth={1.5} />
                </button>
              </div>
            );
          })}
          <button
            onClick={addTab}
            aria-label={t("panel.bottom.terminal_new_tab", {
              defaultValue: "New terminal",
            })}
            className="p-1 ml-1 text-[#777] hover:text-white rounded hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 shrink-0"
          >
            <Plus size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex items-center gap-1 text-[#555] shrink-0 pl-2">
          <button
            onClick={() => setBottomPanelOpen(false)}
            aria-label={t("panel.bottom.close", {
              defaultValue: "Close bottom panel",
            })}
            className="hover:text-white p-1 rounded hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-[#0e0e0e] overflow-hidden relative">
        {terminalElements}
      </div>
    </div>
  );
};

export default BottomPanel;
