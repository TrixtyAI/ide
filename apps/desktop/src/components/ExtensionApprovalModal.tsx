"use client";

/**
 * First-install capability approval modal. Shown exactly once per
 * unseen capability — the decision is persisted via
 * `persistDecision`, so the user only sees this surface when:
 *
 * - The extension is being loaded for the first time, or
 * - The extension's manifest now requests a capability the user has
 *   never explicitly approved or denied.
 *
 * The UX is deliberately conservative:
 * - "Approve all" is possible but not the default — the user ticks
 *   specific rows.
 * - A legacy extension (no `trixty.capabilities` block) shows a bold
 *   warning banner because approving it grants the whole surface.
 * - "Deny" persists the denial, so we don't bug the user on every
 *   launch of an extension they never want to run.
 */

import React, { useMemo, useState } from "react";
import { AlertTriangle, Shield, X } from "lucide-react";
import type { Capability } from "@/api/sandbox/types";
import { CAPABILITY_DESCRIPTIONS } from "@/api/sandbox/capabilities";

export interface ApprovalRequest {
  extensionId: string;
  displayName: string;
  description?: string;
  /** The fresh capability set the manifest is asking for (unified view of
   *  pending + already-granted, so the modal can show "you already
   *  approved X" for context). */
  requested: Capability[];
  /** Capabilities the user has already granted before; pre-ticked. */
  alreadyGranted: Capability[];
  /** Capabilities the user has already denied before; pre-unticked and
   *  surfaced so they can reverse themselves. */
  alreadyDenied: Capability[];
  /** True when the manifest omits `trixty.capabilities` entirely. */
  legacy: boolean;
}

export interface ApprovalDecision {
  approved: Capability[];
  denied: Capability[];
  /** True when the user hit the top-right "Cancel" — treat as a
   *  temporary decline; the manifest's pending capabilities stay
   *  pending for next launch. */
  cancelled: boolean;
}

interface Props {
  request: ApprovalRequest;
  onDecide(decision: ApprovalDecision): void;
}

export default function ExtensionApprovalModal({ request, onDecide }: Props) {
  const [selected, setSelected] = useState<Set<Capability>>(() => {
    const initial = new Set<Capability>();
    for (const cap of request.alreadyGranted) initial.add(cap);
    return initial;
  });

  const toggle = (cap: Capability) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });
  };

  const handleApprove = () => {
    const approved = Array.from(selected);
    const denied = request.requested.filter((c) => !selected.has(c));
    onDecide({ approved, denied, cancelled: false });
  };

  const handleDenyAll = () => {
    onDecide({ approved: [], denied: request.requested, cancelled: false });
  };

  const handleCancel = () => {
    onDecide({ approved: [], denied: [], cancelled: true });
  };

  const selectAll = () => setSelected(new Set(request.requested));
  const selectNone = () => setSelected(new Set());

  const hasChanges = useMemo(() => {
    // Any capability the user is being asked about that isn't already
    // approved → they need to decide before we proceed.
    return request.requested.some(
      (cap) =>
        !request.alreadyGranted.includes(cap) &&
        !request.alreadyDenied.includes(cap),
    );
  }, [request]);

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extension-approval-title"
    >
      <div className="w-[480px] max-h-[80vh] flex flex-col bg-[#111] border border-[#222] rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-[#1a1a1a]">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-950/40 flex items-center justify-center shrink-0">
              <Shield size={18} className="text-blue-400" />
            </div>
            <div>
              <h2
                id="extension-approval-title"
                className="text-sm font-semibold text-white"
              >
                Grant capabilities to {request.displayName}
              </h2>
              <p className="text-[11px] text-[#888] mt-0.5 leading-relaxed">
                {request.description ??
                  "This extension is asking to use the following parts of Trixty. Grant only what you trust."}
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="text-[#666] hover:text-white p-1 -mr-1 -mt-1 rounded transition-colors"
            aria-label="Close approval dialog"
          >
            <X size={16} />
          </button>
        </div>

        {/* Legacy warning */}
        {request.legacy && (
          <div className="mx-5 mt-4 px-3 py-2 rounded border border-amber-900/50 bg-amber-950/30 flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-200 leading-relaxed">
              This extension does not declare a capability list. Approving it
              grants access to every sandbox capability. Prefer extensions whose
              <code className="mx-1 text-amber-100">package.json</code>
              includes a <code className="text-amber-100">trixty.capabilities</code>
              array.
            </p>
          </div>
        )}

        {/* Quick select */}
        <div className="flex items-center gap-2 px-5 py-2 text-[10px] text-[#888]">
          <span>Quick select:</span>
          <button
            onClick={selectAll}
            className="hover:text-white transition-colors"
          >
            all
          </button>
          <span className="text-[#333]">|</span>
          <button
            onClick={selectNone}
            className="hover:text-white transition-colors"
          >
            none
          </button>
        </div>

        {/* Capability list */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {request.requested.length === 0 ? (
            <p className="text-[11px] text-[#666] italic py-6 text-center">
              This extension requested no capabilities. It will run with no host
              access.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {request.requested.map((cap) => {
                const checked = selected.has(cap);
                const wasGranted = request.alreadyGranted.includes(cap);
                const wasDenied = request.alreadyDenied.includes(cap);
                return (
                  <li key={cap}>
                    <label className="flex items-start gap-2 p-2 rounded hover:bg-[#161616] cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(cap)}
                        className="mt-0.5 accent-blue-500"
                        aria-describedby={`${cap}-desc`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="text-[11px] text-white font-mono">
                            {cap}
                          </code>
                          {wasGranted && (
                            <span className="text-[9px] uppercase tracking-wider text-green-400/70">
                              previously approved
                            </span>
                          )}
                          {wasDenied && (
                            <span className="text-[9px] uppercase tracking-wider text-red-400/70">
                              previously denied
                            </span>
                          )}
                        </div>
                        <p
                          id={`${cap}-desc`}
                          className="text-[11px] text-[#888] mt-0.5 leading-relaxed"
                        >
                          {CAPABILITY_DESCRIPTIONS[cap]}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#1a1a1a] bg-[#0c0c0c] rounded-b-xl">
          <button
            onClick={handleDenyAll}
            className="text-[11px] text-[#888] hover:text-red-400 transition-colors"
          >
            Deny all and disable
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 text-[11px] text-[#999] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApprove}
              disabled={!hasChanges && request.alreadyGranted.length === 0}
              className="px-3 py-1.5 text-[11px] bg-white text-black font-semibold rounded hover:bg-white/90 disabled:opacity-40 transition-all"
            >
              Grant selected
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
