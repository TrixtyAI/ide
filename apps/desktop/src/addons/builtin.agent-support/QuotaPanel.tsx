"use client";

import React, { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useL10n } from '@/hooks/useL10n';
import { safeInvoke } from '@/api/tauri';
import { logger } from '@/lib/logger';
import { Zap, RefreshCw, AlertCircle } from 'lucide-react';

interface QuotaInfo {
  model: string;
  limit: number;
  remaining: number;
  ttlMs: number;
  segmentsTotal: number;
  segmentsFilled: number;
  warning: boolean;
}

export const QuotaPanel: React.FC = () => {
  const { cloudEndpoint, aiSettings } = useApp();
  const { t } = useL10n();
  const [quotas, setQuotas] = useState<QuotaInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQuotas = async () => {
    if (!aiSettings.cloudToken || !cloudEndpoint) {
      setIsLoading(false);
      return;
    }

    try {
      const res = await safeInvoke('ollama_proxy', {
        method: 'GET',
        url: `${cloudEndpoint.replace(/\/+$/, '')}/api/quota`,
        headers: { Authorization: `Bearer ${aiSettings.cloudToken}` }
      });

      if (res.status === 200) {
        const data = JSON.parse(res.body);
        // Transform API data to UI structure
        const transformed: QuotaInfo[] = Object.entries(data).map(([model, info]: [string, any]) => {
          const limit = info.limit || 0;
          const remaining = info.remaining || 0;
          const segmentsTotal = limit >= 1000 ? 24 : 12;
          const segmentsFilled = limit > 0 ? Math.ceil((remaining / limit) * segmentsTotal) : 0;
          
          return {
            model,
            limit,
            remaining,
            ttlMs: info.ttlMs || 0,
            segmentsTotal,
            segmentsFilled,
            warning: remaining < (limit * 0.2)
          };
        });
        setQuotas(transformed);
      } else {
        const err = JSON.parse(res.body);
        setError(err.error || 'Failed to fetch quotas');
      }
    } catch (err) {
      logger.error('Quota fetch error:', err);
      setError('Connection failed');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotas();
  }, [aiSettings.cloudToken, cloudEndpoint]);

  if (!aiSettings.cloudToken) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-500">
        <div className="w-16 h-16 bg-purple-500/10 rounded-full flex items-center justify-center mb-6">
          <Zap size={32} strokeWidth={1.5} className="text-purple-500/50" />
        </div>
        <h4 className="text-white font-bold text-lg mb-2">{t('agent.quota.no_cloud')}</h4>
        <p className="text-[13px] text-[#666] max-w-sm leading-relaxed">
          {t('agent.quota.no_cloud_desc')}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <RefreshCw size={24} className="animate-spin text-purple-500/50" />
        <p className="text-[10px] text-[#444] font-bold uppercase tracking-widest">{t('common.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-xl flex gap-3">
        <AlertCircle size={16} strokeWidth={1.5} className="text-red-500 shrink-0 mt-0.5" />
        <p className="text-[12px] text-red-500/80 leading-relaxed">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="space-y-6">
        {quotas.length === 0 && (
           <div className="p-10 border border-dashed border-white/5 rounded-2xl text-center">
              <p className="text-[12px] text-[#555]">No quota data available for your current models.</p>
           </div>
        )}
        {quotas.map((quota, idx) => (
          <div key={idx} className="bg-[#111] border border-white/5 rounded-xl p-5 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Zap size={16} className={quota.warning ? "text-amber-500" : "text-purple-400"} />
                <h5 className="text-[14px] font-bold text-white tracking-tight">{quota.model}</h5>
              </div>
            </div>

            <div className={`flex ${quota.limit >= 1000 ? 'gap-0.5' : 'gap-1'} h-1.5`}>
              {Array.from({ length: quota.segmentsTotal }).map((_, i) => {
                const isFilled = i < quota.segmentsFilled;
                const colorClass = isFilled
                  ? (quota.warning 
                      ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" 
                      : (quota.limit >= 1000 
                          ? "bg-purple-500 shadow-[0_0_12px_rgba(168,85,247,0.7)]" 
                          : "bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]"))
                  : "bg-white/5";

                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-full transition-all duration-700 ${colorClass}`}
                  />
                );
              })}
            </div>

            {quota.ttlMs > 0 && (
              <p className="text-[11px] text-[#666] mt-3 flex items-center gap-1.5">
                <RefreshCw size={10} />
                Resets in {Math.ceil(quota.ttlMs / (1000 * 60 * 60))} hours
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
