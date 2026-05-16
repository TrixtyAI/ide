"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Shield, X } from "lucide-react";
import type { Capability } from "@/api/sandbox/types";
import { CAPABILITY_DESCRIPTIONS } from "@/api/sandbox/capabilities";
import { useL10n } from "@/hooks/useL10n";

export interface ApprovalRequest {
  extensionId: string;
  displayName: string;
  description?: string;
  requested: Capability[];
  alreadyGranted: Capability[];
  alreadyDenied: Capability[];
  legacy: boolean;
}

export interface ApprovalDecision {
  approved: Capability[];
  denied: Capability[];
  cancelled: boolean;
}

interface Props {
  request: ApprovalRequest;
  onDecide(decision: ApprovalDecision): void;
}

export default function ExtensionApprovalModal({ request, onDecide }: Props) {
  const { t } = useL10n();
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
                {t('extension.approval.title', { name: request.displayName })}
              </h2>
              <p className="text-[11px] text-[#888] mt-0.5 leading-relaxed">
                {request.description ?? t('extension.approval.desc')}
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="text-[#666] hover:text-white p-1 -mr-1 -mt-1 rounded transition-colors"
            aria-label={t('window.close')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Legacy warning */}
        {request.legacy && (
          <div className="mx-5 mt-4 px-3 py-2 rounded border border-amber-900/50 bg-amber-950/30 flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-200 leading-relaxed">
              {t('extension.approval.legacy')}
            </p>
          </div>
        )}

        {/* Quick select */}
        <div className="flex items-center gap-2 px-5 py-2 text-[10px] text-[#888]">
          <span>{t('extension.approval.quick_select')}</span>
          <button
            onClick={selectAll}
            className="hover:text-white transition-colors"
          >
            {t('extension.approval.all')}
          </button>
          <span className="text-[#333]">|</span>
          <button
            onClick={selectNone}
            className="hover:text-white transition-colors"
          >
            {t('extension.approval.none')}
          </button>
        </div>

        {/* Capability list */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {request.requested.length === 0 ? (
            <p className="text-[11px] text-[#666] italic py-6 text-center">
              {t('extension.approval.no_caps')}
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
                              {t('extension.approval.prev_approved')}
                            </span>
                          )}
                          {wasDenied && (
                            <span className="text-[9px] uppercase tracking-wider text-red-400/70">
                              {t('extension.approval.prev_denied')}
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
            {t('extension.approval.deny_all')}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 text-[11px] text-[#999] hover:text-white transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleApprove}
              disabled={!hasChanges && request.alreadyGranted.length === 0}
              className="px-3 py-1.5 text-[11px] bg-white text-black font-semibold rounded hover:bg-white/90 disabled:opacity-40 transition-all"
            >
              {t('extension.approval.grant')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
