"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Bug } from "lucide-react";
import { logger } from "@/lib/logger";

interface Props {
  children: ReactNode;
  name: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary isolates runtime crashes in major UI subtrees.
 * It provides a fallback UI with "Retry" and "Report" actions.
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error(`[ErrorBoundary:${this.props.name}] Caught error:`, error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReport = async () => {
    const { error } = this.state;
    const body = encodeURIComponent(
      `## Error Report\n\n**Feature**: ${this.props.name}\n**Message**: ${error?.message}\n\n**Stack Trace**:\n\`\`\`\n${error?.stack}\n\`\`\`\n`
    );
    const url = `https://github.com/TrixtyAI/ide/issues/new?title=[Bug]:+Runtime+error+in+${this.props.name}&body=${body}`;
    
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch (e) {
      logger.error("Failed to open report URL via plugin:", e);
      window.open(url, "_blank");
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#0a0a0a] border border-red-900/20 m-2 rounded-lg transition-all animate-in fade-in duration-500">
          <div className="w-12 h-12 rounded-full bg-red-950/30 flex items-center justify-center mb-4 border border-red-500/50">
            <AlertTriangle className="text-red-500" size={24} />
          </div>
          
          <h2 className="text-white font-semibold text-sm mb-1 uppercase tracking-tight">
            {this.props.name} Error
          </h2>
          <p className="text-[#666] text-[11px] mb-6 text-center max-w-[240px] leading-relaxed">
            A runtime error occurred in this feature. The rest of the IDE remains functional.
          </p>

          <div className="flex items-center gap-3">
            <button
              onClick={this.handleRetry}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#222] text-[#999] hover:text-white text-[11px] font-medium rounded border border-[#333] transition-all"
            >
              <RefreshCw size={13} />
              Retry
            </button>
            
            <button
              onClick={this.handleReport}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#222] text-[#999] hover:text-white text-[11px] font-medium rounded border border-[#333] transition-all"
            >
              <Bug size={13} />
              Report Issue
            </button>
          </div>

          {process.env.NODE_ENV !== "production" && (
            <div className="mt-8 p-3 bg-[#000] border border-[#1a1a1a] rounded max-w-full overflow-hidden">
              <p className="text-[10px] font-mono text-[#444] break-words">
                {this.state.error?.message}
              </p>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
