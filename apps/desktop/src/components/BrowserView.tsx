"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { RotateCw, Globe, ExternalLink, Settings2, Hash, ServerCrash } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";

const BrowserView: React.FC = () => {
  const [port, setPort] = useState<string>("3000");
  const [showModal, setShowModal] = useState<boolean>(true);
  const [url, setUrl] = useState("");
  const [isServerUp, setIsServerUp] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Pure helper to validate port numbers
  const sanitizePort = (value: string): string | null => {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const num = parseInt(trimmed, 10);
    if (num >= 1 && num <= 65535) return trimmed;
    return null;
  };

  const checkServerStatus = useCallback(async (targetPort: string) => {
    const validPort = sanitizePort(targetPort);
    if (!validPort) {
      setIsServerUp(false);
      return false;
    }
    
    setIsChecking(true);
    try {
      const up = await invoke<boolean>("check_port", { port: parseInt(validPort, 10) });
      setIsServerUp(up);
      return up;
    } catch {
      setIsServerUp(false);
      return false;
    } finally {
      setIsChecking(false);
    }
  }, []);

  const confirmPort = async () => {
    const validPort = sanitizePort(port);
    if (!validPort) return;

    const ok = await checkServerStatus(validPort);
    if (ok) {
      setUrl(`http://localhost:${validPort}`);
      setShowModal(false);
    } else {
      setUrl("");
      setShowModal(false);
    }
  };

  const handleReload = async () => {
    const validPort = sanitizePort(port);
    if (!validPort) return;

    const ok = await checkServerStatus(validPort);
    if (ok) {
      if (iframeRef.current && url) {
        iframeRef.current.src = url;
      } else {
        setUrl(`http://localhost:${validPort}`);
      }
    } else {
      setUrl("");
    }
  };

  const handleToolbarPortChange = async (newPort: string) => {
    setPort(newPort);
    const validPort = sanitizePort(newPort);
    if (validPort) {
      const ok = await checkServerStatus(validPort);
      if (ok) {
        setUrl(`http://localhost:${validPort}`);
      } else {
        setUrl("");
      }
    } else {
      setUrl("");
    }
  };

  useEffect(() => {
    if (port && !showModal) {
      checkServerStatus(port);
    }
  }, [port, showModal, checkServerStatus]);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] text-[#ccc] select-none relative overflow-hidden">


      {/* Command Bar Modal */}
      {showModal && (
        <div className="absolute inset-0 z-50 flex flex-col items-center pt-[10vh] bg-black/40 backdrop-blur-[2px]">
          <div className="w-full max-w-sm px-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-[#111] border border-white/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,1)] flex items-center p-1.5 gap-3">
              <div className="pl-3 text-white/20">
                <Hash size={16} />
              </div>
              <div className="flex items-center flex-1 font-mono text-sm">
                <span className="text-white/20 mr-1">localhost:</span>
                <input 
                  type="number" 
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmPort()}
                  autoFocus
                  placeholder="3000"
                  className="bg-transparent border-none outline-none text-white w-full placeholder:text-white/5"
                />
              </div>
              <button 
                onClick={confirmPort}
                disabled={isChecking}
                className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all uppercase tracking-tight disabled:opacity-50"
              >
                {isChecking ? "Checking..." : "Connect"}
              </button>
            </div>
            <p className="text-[10px] text-white/10 text-center mt-3 font-mono">Press ENTER to launch browser</p>
          </div>
        </div>
      )}

      {/* Browser Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#1a1a1a] bg-[#0d0d0d]">
        <div className="flex items-center gap-0.5">
          <button onClick={handleReload} className="p-1.5 rounded hover:bg-white/5 text-white/40 disabled:opacity-20" disabled={isChecking} title="Reload">
            <RotateCw size={12} className={isChecking ? "animate-spin" : ""} />
          </button>
          <button onClick={() => setShowModal(true)} className="p-1.5 rounded hover:bg-white/5 text-white/40" title="Settings">
            <Settings2 size={12} />
          </button>
        </div>
        
        <div className="flex-1 flex items-center bg-[#141414] border border-white/5 rounded-md px-2.5 py-0.5 gap-2 focus-within:border-white/10 transition-colors">
          <Globe size={10} className={isServerUp ? "text-green-500/40" : "text-white/10"} />
          <div className="flex items-center flex-1 text-[11px] font-mono">
            <span className="text-white/10">http://localhost:</span>
            <input 
              type="number" 
              value={port} 
              onChange={(e) => handleToolbarPortChange(e.target.value)}
              placeholder="----"
              className="bg-transparent border-none outline-none text-white/40 flex-1 ml-0.5 placeholder:text-white/5"
            />
          </div>
          {isChecking && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
        </div>

        <button onClick={() => url && open(url)} className="p-1.5 rounded hover:bg-white/5 text-white/20 disabled:opacity-10" disabled={!url}>
          <ExternalLink size={12} />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 bg-black relative flex flex-col items-center justify-center overflow-hidden">
        {(url && isServerUp) ? (
          <iframe 
            ref={iframeRef}
            src={url}
            className="w-full h-full border-none bg-white animate-in fade-in duration-700"
            title="Browser"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        ) : (
          <div className="flex flex-col items-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            <div className="relative">
              <div className={`absolute inset-0 ${isChecking ? "bg-blue-500/20" : "bg-red-500/20"} blur-3xl rounded-full scale-150 animate-pulse`}></div>
              <div className="relative p-6 rounded-2xl bg-white/[0.02] border border-white/5">
                <ServerCrash size={40} className="text-white/10" />
              </div>
              <div className="absolute -top-1 -right-1">
                <div className="flex h-3 w-3">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isChecking ? "bg-blue-400" : "bg-red-400"} opacity-20`}></span>
                  <span className={`relative inline-flex rounded-full h-3 w-3 ${isChecking ? "bg-blue-500" : "bg-red-500"}/40`}></span>
                </div>
              </div>
            </div>
            <div className="text-center space-y-1">
              <h3 className="text-white/40 text-sm font-medium tracking-tight">
                {isChecking ? "Verificando puerto..." : (sanitizePort(port) ? `Servidor en puerto ${port} inactivo` : "Puerto no configurado")}
              </h3>
              <p className="text-white/10 text-[11px] font-mono">
                {isChecking ? "Intentando establecer conexión TCP..." : "Asegúrate de que tu servidor local esté corriendo"}
              </p>
            </div>
            {!isChecking && (
              <button 
                onClick={handleReload}
                className="mt-2 flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.03] border border-white/5 text-white/40 text-[10px] font-bold uppercase tracking-widest hover:bg-white/5 hover:text-white/60 transition-all active:scale-95"
              >
                <RotateCw size={10} /> Reintentar Conexión
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BrowserView;
