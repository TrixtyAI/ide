"use client";

import React, { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { safeInvoke } from '@/api/tauri';
import { logger } from '@/lib/logger';
import { Zap, CreditCard, CheckCircle2, ShieldCheck, ZapOff, ArrowRight, RefreshCw } from 'lucide-react';

interface CloudProfile {
  id: string;
  email: string;
  role: string;
  planId?: any;
}

interface PlanInfo {
  _id: string;
  name: string;
  price: number;
  description?: string;
  features: string[];
}

export const BillingPanel: React.FC = () => {
  const { cloudEndpoint, aiSettings } = useApp();
  const [profile, setProfile] = useState<CloudProfile | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanInfo | null>(null);
  const [availablePlans, setAvailablePlans] = useState<PlanInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchData = async () => {
    if (!aiSettings.cloudToken || !cloudEndpoint) {
      setIsLoading(false);
      return;
    }

    try {
      const baseUrl = cloudEndpoint.replace(/\/+$/, '');
      
      const [profileRes, plansRes] = await Promise.all([
        safeInvoke('ollama_proxy', {
          method: 'GET',
          url: `${baseUrl}/auth/me`,
          headers: { Authorization: `Bearer ${aiSettings.cloudToken}` }
        }),
        safeInvoke('ollama_proxy', {
          method: 'GET',
          url: `${baseUrl}/billing/plans`,
          headers: { Authorization: `Bearer ${aiSettings.cloudToken}` }
        })
      ]);

      if (profileRes.status === 200) {
        const data = JSON.parse(profileRes.body);
        setProfile(data.user);
      }

      if (plansRes.status === 200) {
        const data = JSON.parse(plansRes.body);
        setAvailablePlans(data);
      }
    } catch (err) {
      logger.error('Failed to fetch billing data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [aiSettings.cloudToken, cloudEndpoint]);

  const handleDowngrade = async (planId: string) => {
    setIsProcessing(true);
    try {
      const res = await safeInvoke('ollama_proxy', {
        method: 'POST',
        url: `${cloudEndpoint.replace(/\/+$/, '')}/billing/downgrade`,
        headers: { Authorization: `Bearer ${aiSettings.cloudToken}` },
        body: { planId }
      });

      if (res.status >= 200 && res.status < 300) {
        await fetchData();
        setSelectedPlan(null);
      } else {
        const data = JSON.parse(res.body);
        logger.error('Downgrade failed:', data.error);
      }
    } catch (err) {
      logger.error('Downgrade error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!aiSettings.cloudToken) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-500">
        <div className="w-16 h-16 bg-purple-500/10 rounded-full flex items-center justify-center mb-6">
          <ZapOff size={32} strokeWidth={1.5} className="text-purple-500/50" />
        </div>
        <h4 className="text-white font-bold text-lg mb-2">Cloud Account Required</h4>
        <p className="text-[13px] text-[#666] max-w-sm leading-relaxed">
          Please sign in to your Trixty Cloud account in the Configuration tab to manage your billing and plans.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-6 h-6 border-2 border-purple-500/20 border-t-purple-500 rounded-full animate-spin" />
      </div>
    );
  }

  const currentPlan = profile?.planId;
  const isPro = profile?.role === 'admin' || profile?.role === 'maintainer' || (currentPlan && currentPlan.name !== 'FREE');
  
  // Filter out the plan the user currently has
  const otherPlans = availablePlans.filter(p => p._id !== currentPlan?._id);

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Current Plan Overview */}
      <div className="flex items-center justify-between p-6 bg-white/[0.02] border border-white/5 rounded-2xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
          <ShieldCheck size={120} strokeWidth={1} />
        </div>
        <div className="flex items-center gap-4 relative z-10">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isPro ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
            <Zap size={24} />
          </div>
          <div>
            <p className="text-[10px] text-[#555] font-bold uppercase tracking-widest leading-none mb-1">Your Active Plan</p>
            <h3 className="text-lg font-bold text-white tracking-tight">Trixty {currentPlan?.name || 'FREE'}</h3>
          </div>
        </div>
        <div className="text-right relative z-10">
          <p className="text-[10px] text-[#555] font-bold uppercase tracking-widest leading-none mb-1">Billing Status</p>
          <p className={`text-sm font-bold ${isPro ? 'text-green-400' : 'text-blue-400'}`}>Active</p>
        </div>
      </div>

      {/* Plan Selection Section */}
      <div className="space-y-6">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1.5 h-6 bg-purple-500 rounded-full" />
          <h4 className="text-white font-bold text-lg">Available Plans</h4>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {otherPlans.length === 0 && (
             <div className="p-10 border border-dashed border-white/5 rounded-2xl text-center">
                <p className="text-[12px] text-[#555]">No other plans available at the moment.</p>
             </div>
          )}
          {otherPlans.map((plan) => (
            <div 
              key={plan._id}
              onClick={() => setSelectedPlan(plan)}
              className={`p-6 border rounded-2xl cursor-pointer transition-all relative overflow-hidden group ${
                selectedPlan?._id === plan._id 
                  ? 'bg-purple-500/10 border-purple-500 shadow-lg shadow-purple-900/20' 
                  : 'bg-[#111] border-white/5 hover:border-white/10'
              }`}
            >
              <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-colors ${
                    selectedPlan?._id === plan._id ? 'bg-purple-500 text-white border-purple-400' : 'bg-white/5 border-white/10 text-[#555]'
                  }`}>
                    <Zap size={20} />
                  </div>
                  <div>
                    <h5 className="text-white font-bold">{plan.name} Plan</h5>
                    <p className="text-[12px] text-[#666]">{plan.price === 0 ? 'Basic features for everyone' : 'Professional features for power users'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-black text-white">{plan.price === 0 ? 'FREE' : `$${plan.price}`}</p>
                  <p className="text-[10px] text-[#555] font-bold uppercase">{plan.price === 0 ? 'Forever' : 'per month'}</p>
                </div>
              </div>

              {selectedPlan?._id === plan._id && (
                <div className="mt-6 pt-6 border-t border-purple-500/20 animate-in slide-in-from-top-2 duration-300">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
                    {(plan.features || ['Access to AI Models', 'Standard Support']).map((feature, i) => (
                      <div key={i} className="flex items-center gap-2 text-[12px] text-[#aaa]">
                        <CheckCircle2 size={14} className="text-purple-500" />
                        {feature}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-4">
                    <p className="text-[10px] text-[#555] font-bold uppercase tracking-widest text-center mb-4">
                      {plan.price === 0 ? 'Ready to switch back?' : 'Select Payment Method'}
                    </p>
                    
                    {plan.price === 0 ? (
                       <button
                        onClick={(e) => { e.stopPropagation(); handleDowngrade(plan._id); }}
                        disabled={isProcessing}
                        className="w-full py-3 bg-white text-black hover:bg-[#eee] rounded-xl font-bold text-[13px] transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                      >
                        {isProcessing ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                        Downgrade to FREE Plan
                      </button>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const res = await safeInvoke('ollama_proxy', {
                                method: 'POST',
                                url: `${cloudEndpoint.replace(/\/+$/, '')}/billing/checkout`,
                                headers: { Authorization: `Bearer ${aiSettings.cloudToken}` },
                                body: { planId: plan._id, provider: 'mercadopago' }
                              });
                              if (res.status >= 200 && res.status < 300) {
                                const { url } = JSON.parse(res.body);
                                const { open } = await import('@tauri-apps/plugin-shell');
                                await open(url);
                              }
                            } catch (err) {
                              logger.error('Checkout error:', err);
                            }
                          }}
                          className="p-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all flex items-center justify-center gap-3 group/btn active:scale-95 shadow-lg shadow-blue-900/20"
                        >
                          <CreditCard size={18} />
                          <span className="text-[13px] font-bold">Mercado Pago</span>
                          <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                        </button>

                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const res = await safeInvoke('ollama_proxy', {
                                method: 'POST',
                                url: `${cloudEndpoint.replace(/\/+$/, '')}/billing/checkout`,
                                headers: { Authorization: `Bearer ${aiSettings.cloudToken}` },
                                body: { planId: plan._id, provider: 'paypal' }
                              });
                              if (res.status >= 200 && res.status < 300) {
                                const { url } = JSON.parse(res.body);
                                const { open } = await import('@tauri-apps/plugin-shell');
                                await open(url);
                              }
                            } catch (err) {
                              logger.error('Checkout error:', err);
                            }
                          }}
                          className="p-4 bg-purple-600 hover:bg-purple-50 text-white rounded-xl transition-all flex items-center justify-center gap-3 group/btn active:scale-95 shadow-lg shadow-purple-900/20"
                        >
                          <CreditCard size={18} />
                          <span className="text-[13px] font-bold">PayPal</span>
                          <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
