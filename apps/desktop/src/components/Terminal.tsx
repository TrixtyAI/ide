"use client";

import React, { useEffect, useRef } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { safeInvoke as invoke, type PtyOutputEvent } from "@/api/tauri";
import { useL10n } from "@/hooks/useL10n";
import { logger } from "@/lib/logger";
import * as Sentry from "@sentry/nextjs";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  /**
   * Unique id for this PTY session. Stable across the lifetime of the
   * owning tab — BottomPanel mints a UUID when the tab is created and
   * keeps it until the tab is closed.
   */
  sessionId: string;
  /** Initial working directory. Unused after the first spawn. */
  cwd?: string | null;
  /**
   * Whether this tab is the currently visible one. Inactive tabs stay
   * mounted so their xterm buffer is preserved, but we only run
   * `fit()` when active — fitting a tab whose container is `display:none`
   * yields rows/cols of 0 and corrupts the shell's view of the window size.
   */
  isActive: boolean;
}

// "No PTY session with id ..." is expected noise whenever a resize lands on
// the Rust side after `kill_pty` has already swept the session — most
// commonly during React 18 strict-mode double-mount or while the user is
// dragging panel handles right after closing the bottom panel. Demote
// these to debug so the real PTY problems stay visible.
function logPtyError(label: string, err: unknown): void {
  const msg = typeof err === "string" ? err : JSON.stringify(err);
  
  Sentry.metrics.count('terminal_pty_error', 1, {
    attributes: { label, is_silent: msg.includes("No PTY session with id") ? 'yes' : 'no' }
  });

  if (msg.includes("No PTY session with id")) {
    logger.debug(`${label} (session already gone):`, err);
    return;
  }
  logger.error(label, err);
}

const Terminal: React.FC<TerminalProps> = ({ sessionId, cwd, isActive }) => {
  const { t } = useL10n();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Xterm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  // Set to false during effect cleanup so any in-flight ResizeObserver
  // callback that fires after teardown can short-circuit before it tries
  // to resize a session we just killed.
  const aliveRef = useRef(false);

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;
    aliveRef.current = true;

    const term = new Xterm({
      cursorBlink: true,
      cursorStyle: "bar",
      theme: {
        background: "#0e0e0e",
        foreground: "#cccccc",
        cursor: "#ffffff",
        cursorAccent: "#0e0e0e",
        selectionBackground: "#ffffff30",
        selectionForeground: "#ffffff",
        black: "#0e0e0e",
        red: "#ff6b6b",
        green: "#69db7c",
        yellow: "#ffd43b",
        blue: "#74c0fc",
        magenta: "#da77f2",
        cyan: "#66d9e8",
        white: "#cccccc",
        brightBlack: "#555555",
        brightRed: "#ff8787",
        brightGreen: "#8ce99a",
        brightYellow: "#ffe066",
        brightBlue: "#a5d8ff",
        brightMagenta: "#e599f7",
        brightCyan: "#99e9f2",
        brightWhite: "#ffffff",
      },
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
      lineHeight: 1.3,
      letterSpacing: 0,
      scrollback: 5000,
      // `screenReaderMode: true` makes xterm build a hidden DOM mirror of the
      // visible viewport that assistive technologies can read. Without this,
      // the canvas renderer is opaque to AT and the terminal effectively does
      // not exist for screen-reader users.
      screenReaderMode: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => {
      invoke("write_to_pty", { sessionId, data }).catch((e) =>
        logger.error("PTY write error:", e),
      );
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!aliveRef.current) return;
      if (
        terminalRef.current &&
        terminalRef.current.clientWidth > 0 &&
        terminalRef.current.clientHeight > 0
      ) {
        // xterm's fit() can throw "invalid range" when rows/cols compute to
        // <= 0 — happens mid-resize while the bottom panel container is
        // collapsing. Wrap to keep the observer alive.
        try {
          fitAddon.fit();
        } catch (err) {
          logger.debug("[terminal] fit skipped:", err);
          return;
        }
        // Skip resize when xterm reports 0 rows/cols — happens while the
        // bottom panel is mid-collapse (display:none container). The Rust
        // PTY rejects these as "invalid range".
        if (term.rows < 1 || term.cols < 1) return;
        // `silent: true` keeps `safeInvoke` from emitting its own
        // `[Tauri Invoke Error]` console line — we route the error through
        // `logPtyError` so "session already gone" gets demoted to debug.
        invoke(
          "resize_pty",
          { sessionId, rows: term.rows, cols: term.cols },
          { silent: true },
        ).catch((e) => logPtyError("PTY resize error:", e));
      }
    });
    resizeObserver.observe(terminalRef.current);

    // Let layout settle before the first fit; xterm's measurements read
    // offsetWidth on the container and can return 0 if the bottom panel is
    // still animating in.
    const initialFitTimer = window.setTimeout(() => {
      if (
        terminalRef.current &&
        terminalRef.current.clientWidth > 0 &&
        terminalRef.current.clientHeight > 0
      ) {
        // xterm's fit() can throw "invalid range" when rows/cols compute to
        // <= 0 — happens mid-resize while the bottom panel container is
        // collapsing. Wrap to keep the observer alive.
        try {
          fitAddon.fit();
        } catch (err) {
          logger.debug("[terminal] fit skipped:", err);
          return;
        }
      }
    }, 150);

    let isCanceled = false;
    let unlisten: (() => void) | undefined;

    const setupPty = async () => {
      try {
        const u = await listen<PtyOutputEvent>("pty-output", (event) => {
          // Multiple tabs share one event channel; route by sessionId.
          if (event.payload.sessionId !== sessionId) return;
          if (!isCanceled && xtermRef.current) {
            xtermRef.current.write(event.payload.data);
          }
        });
        if (isCanceled) {
          u();
          return;
        }
        unlisten = u;

        // Pre-fit before spawning so the shell starts with the correct
        // dimensions instead of reflowing on the first prompt.
        if (
          terminalRef.current?.clientWidth &&
          terminalRef.current?.clientHeight
        ) {
          try {
            fitAddon.fit();
          } catch (err) {
            logger.debug("[terminal] pre-spawn fit skipped:", err);
          }
        }

        await invoke("spawn_pty", {
          sessionId,
          cwd: cwd ?? undefined,
          rows: term.rows,
          cols: term.cols,
        });

        Sentry.metrics.count('terminal_pty_spawn', 1);
      } catch (err) {
        Sentry.metrics.count('terminal_pty_error', 1, { attributes: { label: 'setup_failed' } });
        if (!isCanceled && xtermRef.current) {
          xtermRef.current.writeln(
            "\x1b[31m" + t("terminal.error_connect") + "\x1b[0m " + err,
          );
        }
      }
    };

    setupPty();

    return () => {
      isCanceled = true;
      aliveRef.current = false;
      window.clearTimeout(initialFitTimer);
      resizeObserver.disconnect();
      if (unlisten) unlisten();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      // Tear down the Rust-side session. `kill_pty` is a no-op on unknown
      // ids, so a double-unmount (StrictMode, fast refresh) is safe.
      invoke("kill_pty", { sessionId }, { silent: true }).catch((e) =>
        logPtyError("PTY cleanup error:", e),
      );
    };
    // Intentional deps: sessionId and cwd are captured at mount time. If
    // either changes mid-life the tab owner (BottomPanel) remounts this
    // component with a new key — we never re-run spawn for the same mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Re-fit when the tab becomes active: a tab hidden via `display:none`
  // reports 0 width/height, so any fit attempted while inactive corrupts
  // the shell's idea of the window size. We also resize the backend so
  // the child shell sees the new dimensions immediately.
  useEffect(() => {
    if (!isActive) return;
    const term = xtermRef.current;
    const fit = fitAddonRef.current;
    if (!term || !fit || !terminalRef.current?.clientWidth) return;
    try {
      fit.fit();
    } catch (err) {
      logger.debug("[terminal] active-tab fit skipped:", err);
      return;
    }
    if (term.rows < 1 || term.cols < 1) return;
    invoke(
      "resize_pty",
      { sessionId, rows: term.rows, cols: term.cols },
      { silent: true },
    ).catch((e) => logPtyError("PTY resize error:", e));
  }, [isActive, sessionId]);

  return (
    <div
      ref={terminalRef}
      role="region"
      aria-label={t("panel.bottom.terminal")}
      className="w-full p-3 h-full"
    />
  );
};

export default Terminal;
