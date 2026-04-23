import React, { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useL10n } from '@/hooks/useL10n';
import { safeInvoke } from '@/api/tauri';
import { AlertCircle, RefreshCw, Server, User, Zap } from 'lucide-react';
import { logger } from '@/lib/logger';

interface UserProfile {
  id: string;
  email: string;
  role: string;
  planId?: string;
}

interface QuotaData {
  model: string;
  limit: number;
  used: number;
  remaining: number;
  segmentsTotal: number;
  segmentsFilled: number;
  ttlMs: number;
  warning: boolean;
}

export const QuotaPanel: React.FC = () => {
  const { aiSettings, cloudEndpoint } = useApp();
  const { t } = useL10n();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [quotas, setQuotas] = useState<QuotaData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchQuotaData = async () => {
      if (!aiSettings.useCloudModel || !aiSettings.cloudToken) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const baseUrl = cloudEndpoint;
        const authUrl = `${baseUrl.replace(/\/+$/, '')}/auth/me`;
        const quotaUrl = `${baseUrl.replace(/\/+$/, '')}/api/quota`;

        const [profileRes, quotaRes] = await Promise.all([
          safeInvoke('ollama_proxy', {
            method: 'GET',
            url: authUrl,
            headers: { Authorization: `Bearer ${aiSettings.cloudToken}` },
            body: { type: 'version' }
          }),
          safeInvoke('ollama_proxy', {
            method: 'GET',
            url: quotaUrl,
            headers: { Authorization: `Bearer ${aiSettings.cloudToken}` },
            body: { type: 'version' }
          })
        ]);

        if (cancelled) return;

        if (profileRes.status >= 200 && profileRes.status < 300) {
          const data = JSON.parse(profileRes.body);
          setProfile(data.user || data);
        } else {
          throw new Error('Failed to fetch user profile.');
        }

        if (quotaRes.status >= 200 && quotaRes.status < 300) {
          const data = JSON.parse(quotaRes.body);
          setQuotas(data.quotas || []);
        } else {
          throw new Error('Failed to fetch quota data.');
        }
      } catch (err: unknown) {
        if (!cancelled) {
          logger.error('Quota fetch error:', err);
          setError((err as Error).message || 'Failed to load quotas.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchQuotaData();

    return () => {
      cancelled = true;
    };
  }, [aiSettings.useCloudModel, cloudEndpoint, aiSettings.cloudToken]);

  if (!aiSettings.useCloudModel || !aiSettings.cloudToken) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-10 text-center animate-in fade-in duration-500">
        <div className="w-16 h-16 bg-purple-500/10 rounded-full flex items-center justify-center mb-6">
          <Server size={32} strokeWidth={1.5} className="text-purple-500/50" />
        </div>
        <h4 className="text-white font-bold text-lg mb-2">{t('agent.quota.title')}</h4>
        <p className="text-[13px] text-[#666] max-w-sm leading-relaxed">
          {t('agent.quota.unauthorized')}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <RefreshCw size={24} className="animate-spin text-purple-500/50" />
        <p className="text-[10px] text-[#444] font-bold uppercase tracking-widest">{t('agent.quota.loading')}</p>
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
      {profile && (
        <div className="p-4 bg-purple-500/5 border border-purple-500/20 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center border border-white/10 shrink-0">
              <User size={24} strokeWidth={1.5} className="text-purple-400" />
            </div>
            <div>
              <h4 className="text-white font-bold text-sm leading-tight">{profile.email}</h4>
              <p className="text-[11px] text-purple-400/80 font-mono mt-1 uppercase tracking-widest">
                Role: {profile.role}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {quotas.map((quota, idx) => (
          <div key={idx} className="bg-[#111] border border-white/5 rounded-xl p-5 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Zap size={16} className={quota.warning ? "text-amber-500" : "text-purple-400"} />
                <h5 className="text-[14px] font-bold text-white tracking-tight">{quota.model}</h5>
              </div>
              <span className="text-[12px] font-mono text-[#888]">
                {quota.remaining} / {quota.limit} left
              </span>
            </div>

            <div className="flex gap-1 h-3">
              {Array.from({ length: quota.segmentsTotal }).map((_, i) => {
                const isFilled = i < quota.segmentsFilled;
                const colorClass = isFilled
                  ? (quota.warning ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" : "bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]")
                  : "bg-white/5";

                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-sm transition-all duration-500 ${colorClass}`}
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

        {quotas.length === 0 && (
          <p className="text-[12px] text-[#666] italic text-center py-4">
            No quota limitations found for your current plan.
          </p>
        )}
      </div>
    </div>
  );
};
