"use client";

import React, { useEffect, useRef } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { safeInvoke as invoke } from "@/api/tauri";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";
import "@xterm/xterm/css/xterm.css";

const Terminal: React.FC = () => {
  const { rootPath, terminalPath } = useApp();
  const { t } = useL10n();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Xterm | null>(null);
  const initialized = useRef(false);

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

    term.onData((data) => {
      invoke("write_to_pty", { data }).catch(e => console.error("PTY write error:", e));
    });

    const resizeObserver = new ResizeObserver(() => {
      if (terminalRef.current && terminalRef.current.clientWidth > 0) {
        fitAddon.fit();
        invoke("resize_pty", {
          rows: term.rows,
          cols: term.cols
        }).catch(e => console.error("PTY resize error:", e));
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
    };
  }, []);

  // 2. Handle PTY session and path changes
  useEffect(() => {
    if (!xtermRef.current) return;
    
    let isCanceled = false;
    let unlisten: (() => void) | undefined;

    const setupPty = async () => {
      try {
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
        await invoke("spawn_pty", { cwd: terminalPath || rootPath || undefined });
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
  }, [terminalPath, rootPath]);

  return <div ref={terminalRef} className="w-full p-3 h-full" />;
};

export default Terminal;
