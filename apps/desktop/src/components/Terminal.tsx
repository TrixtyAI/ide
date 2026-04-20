"use client";

import React, { useEffect, useRef } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { safeInvoke as invoke } from "@/api/tauri";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";
import { logger } from "@/lib/logger";
import "@xterm/xterm/css/xterm.css";

const Terminal: React.FC = () => {
  const { rootPath, terminalPath } = useApp();
  const { t } = useL10n();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Xterm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // 1. Initialize Xterm once on mount
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

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
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => {
      invoke("write_to_pty", { data }).catch(e => logger.error("PTY write error:", e));
    });

    const resizeObserver = new ResizeObserver(() => {
      if (terminalRef.current && terminalRef.current.clientWidth > 0) {
        fitAddon.fit();
        invoke("resize_pty", {
          rows: term.rows,
          cols: term.cols
        }).catch(e => logger.error("PTY resize error:", e));
      }
    });
    resizeObserver.observe(terminalRef.current);

    setTimeout(() => {
      if (terminalRef.current && terminalRef.current.clientWidth > 0) {
        fitAddon.fit();
      }
    }, 150);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      // Kill the Rust-side PTY so the child shell and reader thread don't leak
      // when the component unmounts (e.g. the bottom panel is closed).
      // `kill_pty` returns Ok even with no active PTY, so any rejection here is a
      // real failure (IPC missing, mutex poisoned, etc.) and worth surfacing.
      invoke("kill_pty").catch((e) => logger.error("PTY cleanup error:", e));
    };
  }, []);

  // 2. Handle PTY session and path changes
  useEffect(() => {
    if (!xtermRef.current) return;

    const targetPath = terminalPath || rootPath || undefined;

    let isCanceled = false;
    let unlisten: (() => void) | undefined;

    const setupPty = async () => {
      try {
        // Kill any existing PTY before spawning a new one
        await invoke("kill_pty").catch(() => { /* ignore if none active */ });

        const u = await listen<string>("pty-output", (event) => {
          if (!isCanceled && xtermRef.current) {
            xtermRef.current.write(event.payload);
          }
        });

        if (isCanceled) {
          u();
          return;
        }

        unlisten = u;

        // Fit the terminal to its container before spawning so the shell
        // starts with the correct rows/cols and avoids a reflow on the first prompt.
        const term = xtermRef.current;
        if (term && fitAddonRef.current && terminalRef.current?.clientWidth) {
          fitAddonRef.current.fit();
        }

        await invoke("spawn_pty", {
          cwd: targetPath,
          rows: term?.rows,
          cols: term?.cols,
        });
      } catch (err) {
        if (!isCanceled && xtermRef.current) {
          xtermRef.current.writeln("\x1b[31m" + t('terminal.error_connect') + "\x1b[0m " + err);
        }
      }
    };

    setupPty();

    return () => {
      isCanceled = true;
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalPath, rootPath]);

  return <div ref={terminalRef} className="w-full p-3 h-full" />;
};

export default Terminal;
