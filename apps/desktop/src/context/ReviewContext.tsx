"use client";

// Holds the currently-pending tool-approval request so both the AI chat
// (which kicks off the request) and the Reviewer panel (which renders the
// full-height diff/editor outside the chat column) can see the same state.
//
// Before this split, `pendingTool` + the per-call resolver Map lived as local
// React state inside `AiChatComponent`. That meant `page.tsx` could not mount
// a side-panel against the same state without prop-drilling, so the destructive
// tool approval had to squeeze into the 380 px AI panel alongside the chat log.
// Lifting it into its own context keeps the tool loop semantics identical
// while letting a sibling panel subscribe to the same pendingTool handle.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ApprovalResult, ToolArgs } from "@/addons/builtin.ai-assistant/ToolApprovalPanel";

export interface PendingTool {
  id: string;
  name: string;
  args: ToolArgs;
}

interface ReviewContextValue {
  pendingTool: PendingTool | null;
  /**
   * Kicks off a tool-approval request. Mints a callId if absent, registers a
   * resolver on the ref-backed Map, publishes `pendingTool`, and returns a
   * Promise that settles when the caller resolves the request. Handles the
   * same stale-resolver cleanup and callId-collision defense the inline
   * version in AiChatComponent used to have.
   */
  requestToolApproval: (tool: Omit<PendingTool, "id"> & { id?: string }) => Promise<ApprovalResult>;
  /**
   * Called by the Reviewer panel or the inline dialog when the user hits
   * Allow / Deny / Escape. Resolves the matching Promise and clears
   * `pendingTool` if the resolution was for the visible request.
   */
  resolvePendingTool: (result: ApprovalResult) => void;
}

const ReviewContext = createContext<ReviewContextValue | undefined>(undefined);

// Set of tools that benefit from the dedicated Reviewer panel (wide layout,
// full-height DiffEditor). Anything not in this set stays in the compact
// inline card inside the AI chat. Exported so both the page column and the
// chat panel branch on the same single source of truth.
const REVIEWER_ELIGIBLE_TOOLS: ReadonlySet<string> = new Set([
  "write_file",
  "execute_command",
  "remember",
]);

export function isReviewerEligible(toolName: string): boolean {
  return REVIEWER_ELIGIBLE_TOOLS.has(toolName);
}

export const ReviewProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pendingTool, setPendingTool] = useState<PendingTool | null>(null);
  const pendingToolRef = useRef<PendingTool | null>(null);
  useEffect(() => {
    pendingToolRef.current = pendingTool;
  }, [pendingTool]);

  // Per-call permission resolvers. A Map keyed by call id keeps concurrent
  // prompts independent; on unmount everything still pending is denied so
  // no awaiter is stranded past the component lifetime.
  const pendingResolversRef = useRef<Map<string, (result: ApprovalResult) => void>>(new Map());
  useEffect(() => {
    const resolvers = pendingResolversRef.current;
    return () => {
      for (const resolver of resolvers.values()) resolver({ allowed: false });
      resolvers.clear();
    };
  }, []);

  const requestToolApproval = useCallback<ReviewContextValue["requestToolApproval"]>(
    ({ id, name, args }) => {
      const callId = id ?? crypto.randomUUID();

      return new Promise<ApprovalResult>((resolve) => {
        // Any still-open prompt that is NOT the new one gets denied: the UI
        // only shows one approval at a time, so leaving its Promise dangling
        // would be a memory leak and a tool-loop hang.
        for (const [oldId, oldResolver] of pendingResolversRef.current) {
          if (oldId !== callId) {
            oldResolver({ allowed: false });
            pendingResolversRef.current.delete(oldId);
          }
        }
        // Defense against a callId collision (a misbehaving provider reusing
        // an id): resolve the prior resolver as denied before replacing it.
        const existing = pendingResolversRef.current.get(callId);
        if (existing) existing({ allowed: false });
        pendingResolversRef.current.set(callId, resolve);
        setPendingTool({ id: callId, name, args });
      });
    },
    [],
  );

  const resolvePendingTool = useCallback<ReviewContextValue["resolvePendingTool"]>((result) => {
    const current = pendingToolRef.current;
    if (!current) return;
    const resolver = pendingResolversRef.current.get(current.id);
    if (!resolver) return;
    pendingResolversRef.current.delete(current.id);
    resolver(result);
    setPendingTool((prev) => (prev && prev.id === current.id ? null : prev));
  }, []);

  const value = useMemo(
    () => ({ pendingTool, requestToolApproval, resolvePendingTool }),
    [pendingTool, requestToolApproval, resolvePendingTool],
  );

  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
};

export function useReview(): ReviewContextValue {
  const ctx = useContext(ReviewContext);
  if (!ctx) throw new Error("useReview must be used within a ReviewProvider");
  return ctx;
}
