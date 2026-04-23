"use client";

import React from "react";
import { ClipboardCheck } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useAgent } from "@/context/AgentContext";
import { useReview, isReviewerEligible } from "@/context/ReviewContext";
import { useL10n } from "@/hooks/useL10n";
import { ToolApprovalPanel } from "@/addons/builtin.ai-assistant/ToolApprovalPanel";

/**
 * Right-most dock column that hosts the `ToolApprovalPanel` for destructive
 * tools (`write_file`, `execute_command`, `remember`) when the viewport is
 * wide enough to spare the horizontal space. The panel itself lives at the
 * right of the AI chat so the user can read the agent's reasoning and the
 * diff side-by-side.
 *
 * Renders nothing when there is no pending tool, or when the pending tool
 * is an inline-eligible read-only one (the compact card inside the AI chat
 * handles those). Page-level layout is responsible for only mounting this
 * component when the viewport can actually afford the extra column.
 */
const ReviewerPanel: React.FC = () => {
  const { rootPath } = useApp();
  const { memory } = useAgent();
  const { pendingTool, resolvePendingTool } = useReview();
  const { t } = useL10n();

  if (!pendingTool || !isReviewerEligible(pendingTool.name)) {
    return null;
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#0e0e0e] border-l border-border-subtle">
      <div className="p-3 border-b border-[#1a1a1a] flex items-center gap-2 bg-[#0a0a0a] shrink-0">
        <ClipboardCheck size={14} className="text-white/60" />
        <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest">
          {t("ai.reviewer.title")}
        </span>
        <span className="ml-auto text-[10px] text-white/30 font-mono">{pendingTool.name}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        <ToolApprovalPanel
          tool={pendingTool}
          rootPath={rootPath}
          memory={memory}
          onResolve={resolvePendingTool}
          t={t}
        />
      </div>
    </div>
  );
};

export default ReviewerPanel;
