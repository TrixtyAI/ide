import React, { useState } from "react";
import { useSettings } from "@/context/SettingsContext";
import { useL10n } from "@/hooks/useL10n";
import { Key, Eye, EyeOff, Plus, Trash2, Globe, Sparkles, AlertCircle } from "lucide-react";
import { PROVIDERS } from "../builtin.ai-assistant/providerConfig";

export const ProvidersPanel: React.FC = () => {
  const { aiSettings, updateAISettings } = useSettings();
  const { t } = useL10n();
  const [showKey, setShowKey] = useState(false);
  const [newModel, setNewModel] = useState("");

  const activeProviderId = aiSettings.activeProvider || 'gemini';
  const provider = PROVIDERS[activeProviderId];
  const apiKey = aiSettings.providerKeys[activeProviderId] || '';
  const models = aiSettings.providerModels[activeProviderId] || [];

  const handleProviderChange = (id: 'gemini' | 'openrouter') => {
    updateAISettings({ activeProvider: id });
    setNewModel("");
  };

  const handleKeyChange = (val: string) => {
    updateAISettings({
      providerKeys: {
        ...aiSettings.providerKeys,
        [activeProviderId]: val
      }
    });
  };

  const addModel = () => {
    if (!newModel.trim()) return;
    if (models.includes(newModel.trim())) {
      setNewModel("");
      return;
    }
    
    updateAISettings({
      providerModels: {
        ...aiSettings.providerModels,
        [activeProviderId]: [...models, newModel.trim()]
      }
    });
    setNewModel("");
  };

  const removeModel = (modelId: string) => {
    updateAISettings({
      providerModels: {
        ...aiSettings.providerModels,
        [activeProviderId]: models.filter(m => m !== modelId)
      }
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold text-white">{t('agent.providers.title')}</h4>
        <p className="text-[11px] text-[#555]">{t('agent.providers.desc')}</p>
      </div>

      <div className="space-y-6 max-w-lg">
        {/* Provider Selector */}
        <div className="space-y-2">
          <label className="text-[10px] text-[#555] font-bold uppercase tracking-widest">{t('agent.providers.active_provider')}</label>
          <div className="flex p-1 bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl">
            {Object.values(PROVIDERS).map((p) => {
               const Icon = p.icon;
               return (
                <button
                  key={p.id}
                  onClick={() => handleProviderChange(p.id as 'gemini' | 'openrouter')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[11px] font-bold transition-all ${
                    activeProviderId === p.id 
                      ? "bg-white/10 text-white shadow-sm" 
                      : "text-[#555] hover:text-[#888] hover:bg-white/5"
                  }`}
                >
                  <Icon size={14} className={activeProviderId === p.id ? "" : "opacity-50"} />
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* API Key Input */}
        <div className="space-y-2">
          <label className="text-[10px] text-[#555] font-bold uppercase tracking-widest">{t('agent.providers.api_key')}</label>
          <div className="relative group">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => handleKeyChange(e.target.value)}
              placeholder={t('agent.providers.api_key_placeholder')}
              className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-3 pr-10 text-[13px] text-[#ccc] font-mono focus:border-blue-500/50 outline-none transition-all"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#444] hover:text-white transition-colors"
              title={showKey ? t('agent.providers.hide_key') : t('agent.providers.show_key')}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {!apiKey && (
             <p className="text-[10px] text-amber-500/70 italic flex items-center gap-1 mt-1">
               <AlertCircle size={10} /> {t('agent.providers.no_key')}
             </p>
          )}
        </div>

        {/* Models List */}
        <div className="space-y-4 pt-4 border-t border-white/5">
          <label className="text-[10px] text-[#555] font-bold uppercase tracking-widest">{t('agent.providers.models_title')}</label>
          
          <div className="space-y-1">
            {models.map((m) => (
              <div 
                key={m}
                className="flex items-center justify-between p-2 pl-3 bg-white/[0.02] border border-white/5 rounded-lg group hover:border-white/10 transition-all"
              >
                <span className="text-[12px] text-[#999] font-mono">{m}</span>
                <button
                  onClick={() => removeModel(m)}
                  className="p-1.5 text-[#444] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            
            {models.length === 0 && (
              <div className="p-8 border border-dashed border-[#1a1a1a] rounded-xl flex flex-col items-center justify-center text-center">
                <Sparkles size={24} className="text-[#222] mb-2" />
                <p className="text-[11px] text-[#444]">{t('agent.providers.no_models')}</p>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <input
              type="text"
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addModel()}
              placeholder={t('agent.providers.add_model_placeholder', { example: provider.placeholder })}
              className="flex-1 bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-2.5 text-[12px] text-[#ccc] focus:border-blue-500/50 outline-none"
            />
            <button
              onClick={addModel}
              disabled={!newModel.trim()}
              className="px-4 py-2 bg-white text-black text-[11px] font-bold rounded-lg hover:bg-white/90 disabled:opacity-50 disabled:grayscale transition-all flex items-center gap-2"
            >
              <Plus size={14} />
              {t('agent.providers.add_model')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
