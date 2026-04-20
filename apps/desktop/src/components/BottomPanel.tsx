"use client";

import React, { useState } from "react";
import Terminal from "./Terminal";
import { X, Terminal as TerminalIcon, Plus, ExternalLink, Loader2 } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";
import { listen } from "@tauri-apps/api/event";
import { safeInvoke as invoke } from "@/api/tauri";
import { logger } from "@/lib/logger";

interface PortEntry {
  port: number;
  label: string;
}

const BottomPanel: React.FC = () => {
  const { setBottomPanelOpen } = useApp();
  const { t } = useL10n();
  const [activeTab, setActiveTab] = useState("terminal");
  const [ports] = useState<PortEntry[]>([]); // User manually added (deprecated for discovery)
  const [discoveredPorts, setDiscoveredPorts] = useState<number[]>([]);
  const [ignoredPorts, setIgnoredPorts] = useState<number[]>([]);
  const [tunnels, setTunnels] = useState<Record<number, { url: string; loading: boolean }>>({});
  const [newPort, setNewPort] = useState("");
  const [isAddingPort, setIsAddingPort] = useState(false);

  // 1. Port Discovery Polling
  React.useEffect(() => {
    if (activeTab !== "ports") return;

    const refreshPorts = async () => {
      try {
        const active = await invoke("get_active_ports");
        // Only show ports that aren't in the ignored list
        setDiscoveredPorts(active.filter((p: number) => !ignoredPorts.includes(p)));
      } catch (e) {
        logger.error("Discovery error:", e);
      }
    };

    refreshPorts();
    const interval = setInterval(refreshPorts, 5000);
    return () => clearInterval(interval);
  }, [activeTab, ignoredPorts]); // Re-run filter if ignoredPorts changes

  // 2. Listen for tunnel events
  React.useEffect(() => {
    let unlisten: () => void;
    const setup = async () => {
      unlisten = await listen<[number, string]>("tunnel-ready", (event) => {
        const [port, url] = event.payload;
        setTunnels(prev => ({
          ...prev,
          [port]: { url, loading: false }
        }));
      });
    };
    setup();
    return () => { if (unlisten) unlisten(); };
  }, []);

  const handleForwardPort = async (port: number) => {
    setTunnels(prev => ({ ...prev, [port]: { url: "", loading: true } }));
    try {
      const url = await invoke("start_tunnel", { port });
      setTunnels(prev => ({ ...prev, [port]: { url, loading: false } }));
    } catch (e) {
      logger.error("Tunnel error:", e);
      setTunnels(prev => {
        const next = { ...prev };
        delete next[port];
        return next;
      });
      alert(`Could not start tunnel for port ${port}: ${e}`);
    }
  };

  const handleStopTunnel = async (port: number) => {
    try {
      await invoke("stop_tunnel", { port });
      setTunnels(prev => {
        const next = { ...prev };
        delete next[port];
        return next;
      });
    } catch (e) {
      logger.error("Stop tunnel error:", e);
    }
  };

  const handleAddPort = () => {
    const p = parseInt(newPort);
    if (p && p > 0 && p <= 65535) {
      if (!discoveredPorts.includes(p)) {
        setDiscoveredPorts(prev => [...prev, p]);
      }
      setIsAddingPort(false);
      setNewPort("");
    }
  };

  const handleOpenPort = async (port: number) => {
    const url = tunnels[port]?.url || `http://localhost:${port}`;
    try {
      const { open: shellOpen } = await import("@tauri-apps/plugin-shell");
      await shellOpen(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  const handleIgnorePort = (port: number) => {
    setIgnoredPorts(prev => [...prev, port]);
    setDiscoveredPorts(prev => prev.filter(p => p !== port));
  };

  const tabs = [
    { id: "terminal", label: t('panel.bottom.terminal'), icon: TerminalIcon },

    // TODO: FIX PORTS BUGS
    //{ id: "ports", label: t('panel.bottom.ports'), icon: Globe },
  ];

  return (
    <div className="h-full bg-[#0e0e0e] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 h-[36px] bg-[#0a0a0a] shrink-0 border-t border-[#1a1a1a]">
        <div className="flex gap-4 h-full">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`text-[11px] font-medium h-full border-b transition-colors uppercase tracking-wider flex items-center gap-1.5 ${activeTab === tab.id
                ? "border-white text-white"
                : "border-transparent text-[#555] hover:text-white/70"
                }`}
            >
              <tab.icon size={14} strokeWidth={1.5} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 text-[#555]">
          <button
            onClick={() => setBottomPanelOpen(false)}
            className="hover:text-white p-1 rounded hover:bg-white/5 transition-colors"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-[#0e0e0e] overflow-hidden relative">
        {/* Terminal Tab - Kept mounted to prevent reload/unmount */}
        <div className={`h-full ${activeTab === "terminal" ? "block" : "hidden"}`}>
          <Terminal />
        </div>

        {/* Ports Tab */}
        <div className={`h-full flex-col ${activeTab === "ports" ? "flex" : "hidden"}`}>
          {ports.length === 0 && !isAddingPort ? (
            /* VS Code Style Empty State */
            <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-lg mx-auto text-center animate-in fade-in duration-500">
              <p className="text-[13px] text-[#888] mb-6 leading-relaxed">
                {t('panel.bottom.ports.none')}
              </p>
              <button
                onClick={() => setIsAddingPort(true)}
                className="px-6 py-2 bg-[#007acc] hover:bg-[#0062a3] text-white text-[13px] font-medium rounded transition-colors shadow-lg"
              >
                {t('panel.bottom.ports.forward_button')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Ports Header / Toolbar */}
              <div className="flex items-center gap-2 p-2 border-b border-[#1a1a1a] bg-[#0c0c0c]">
                <button
                  onClick={() => setIsAddingPort(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-[#ccc] hover:bg-white/5 rounded transition-colors"
                >
                  <Plus size={14} />
                  {t('panel.bottom.ports.forward_button')}
                </button>
              </div>

              {/* Ports Table */}
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead>
                    <tr className="text-[11px] text-[#555] border-b border-[#1a1a1a] sticky top-0 bg-[#0e0e0e]">
                      <th className="px-4 py-2 font-medium uppercase tracking-wider w-[150px]">{t('panel.bottom.ports.table_port')}</th>
                      <th className="px-4 py-2 font-medium uppercase tracking-wider">{t('panel.bottom.ports.table_local')}</th>
                      <th className="px-4 py-2 font-medium uppercase tracking-wider">{t('panel.bottom.ports.table_forwarded')}</th>
                      <th className="px-4 py-2 font-medium uppercase tracking-wider w-[80px]"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#161616]">
                    {isAddingPort && (
                      <tr className="bg-[#1a1a1a]/30 animate-in slide-in-from-top-1 duration-200">
                        <td className="px-4 py-2">
                          <input
                            autoFocus
                            type="number"
                            value={newPort}
                            onChange={(e) => setNewPort(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAddPort();
                              if (e.key === "Escape") setIsAddingPort(false);
                            }}
                            placeholder={t('panel.bottom.ports.placeholder')}
                            className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-[12px] text-white focus:border-[#007acc] outline-none"
                          />
                        </td>
                        <td className="px-4 py-2 text-[12px] text-[#444]">---</td>
                        <td className="px-4 py-2 text-[12px] text-[#444]">---</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => setIsAddingPort(false)} className="text-[#555] hover:text-white">
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    )}

                    {discoveredPorts.map((port) => (
                      <tr key={port} className="group hover:bg-white/[0.02] transition-colors animate-in fade-in duration-300">
                        <td className="px-4 py-2.5 text-[12px] text-white font-mono flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]" />
                          {port}
                        </td>
                        <td className="px-4 py-2.5 text-[12px] text-[#888] font-mono">localhost:{port}</td>
                        <td className="px-4 py-2.5">
                          {tunnels[port] ? (
                            <div className="flex items-center gap-2">
                              {tunnels[port].loading ? (
                                <div className="flex items-center gap-2 text-[11px] text-[#555]">
                                  <Loader2 size={12} className="animate-spin" />
                                  {t('panel.bottom.ports.starting_tunnel')}
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleOpenPort(port)}
                                  className="px-2 py-0.5 border border-green-500/30 rounded bg-green-500/5 text-[11px] text-green-400 hover:border-green-400 hover:bg-green-500/10 transition-all flex items-center gap-1.5 font-mono group/btn"
                                >
                                  {tunnels[port].url}
                                  <ExternalLink size={10} className="text-green-600 group-hover/btn:text-green-300 transition-colors" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => handleForwardPort(port)}
                              className="px-2 py-0.5 border border-white/20 rounded bg-white/5 text-[11px] text-[#555] hover:text-white hover:border-white/40 transition-all"
                            >
                              {t('panel.bottom.ports.forward_button')}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => tunnels[port] ? handleStopTunnel(port) : handleIgnorePort(port)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-[#555] hover:text-red-400 transition-all"
                            title={tunnels[port] ? t('panel.bottom.ports.stop_tooltip') : t('panel.bottom.ports.ignore_tooltip')}
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BottomPanel;
