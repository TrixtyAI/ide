"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAgent } from "@/context/AgentContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useSettings } from "@/context/SettingsContext";
import { useL10n } from "@/hooks/useL10n";
import {
  Bot,
  BookOpen, Sparkles, Save, RefreshCw, CheckCircle2, Lock, AlertCircle, AlertTriangle
} from "lucide-react";
import { logger } from "@/lib/logger";

interface AgentSettingsProps {
  activeTab: 'profile' | 'manual' | 'user' | 'skills' | 'documentations' | 'design' | 'memory' | 'configuration';
}

const AgentSettings: React.FC<AgentSettingsProps> = ({ activeTab }) => {
  const { rootPath } = useWorkspace();
  const {
    identity, soul, agents, userContext, memory, design,
    skills, activeSkills, toggleSkill, docs, activeDocs, toggleDoc,
    saveAgentFile, isLoading
  } = useAgent();
  const { aiSettings, updateAISettings } = useSettings();
  const { t } = useL10n();

  const getInitialContent = (tab: AgentSettingsProps['activeTab']) => {
    switch (tab) {
      case 'manual': return agents || '';
      case 'design': return design || '';
      case 'user': return userContext || '';
      default: return '';
    }
  };

  const [localContent, setLocalContent] = useState(() => getInitialContent(activeTab));
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const lastSyncedContentRef = useRef(localContent);
  const previousIsLoadingRef = useRef(isLoading);
  const previousActiveTabRef = useRef(activeTab);

  // Reset the editor buffer on tab change and hydrate once async agent data
  // finishes loading, but only when the buffer still matches the last value
  // we synced in — that way an in-progress edit is never clobbered by a
  // background refresh completing.
  useEffect(() => {
    const nextContent = getInitialContent(activeTab);
    const tabChanged = previousActiveTabRef.current !== activeTab;
    const finishedLoading = previousIsLoadingRef.current && !isLoading;
    const isDirty = localContent !== lastSyncedContentRef.current;

    if (!isLoading && (tabChanged || (finishedLoading && !isDirty))) {
      setLocalContent(nextContent);
      lastSyncedContentRef.current = nextContent;
    }

    previousIsLoadingRef.current = isLoading;
    previousActiveTabRef.current = activeTab;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isLoading, agents, design, userContext]);

  const handleSave = async (fileName: 'AGENTS.md' | 'USER.md' | 'MEMORY.md' | 'TOOLS.md' | 'DESIGN.md') => {
    setIsSaving(true);
    try {
      await saveAgentFile(fileName, localContent);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      logger.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const renderTabContent = () => {
    const projectRequiredTabs = ['manual', 'design', 'skills', 'documentations', 'memory'];
    if (!rootPath && projectRequiredTabs.includes(activeTab)) {
      const errorMsg = activeTab === 'manual' ? t('agent.manual.no_project') : 
                     (activeTab === 'design' ? t('agent.design.no_project') : 
                     (activeTab === 'skills' ? t('agent.skills.no_project') : t('agent.documentations.no_project')));
      return (
        <div className="flex flex-col items-center justify-center py-20 px-10 text-center animate-in fade-in duration-500">
          <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mb-6">
            <AlertCircle size={32} strokeWidth={1.5} className="text-amber-500/50" />
          </div>
          <h4 className="text-white font-bold text-lg mb-2">{t('git.no_repo')}</h4>
          <p className="text-[13px] text-[#666] max-w-sm leading-relaxed">
            {errorMsg}
          </p>
        </div>
      );
    }

    switch (activeTab) {
      // ... (rest of the switch stays the same)
      case 'profile':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl flex gap-4">
              <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 shrink-0">
                <Bot size={32} strokeWidth={1.5} className="text-blue-400" />
              </div>
              <div>
                <h4 className="text-white font-bold text-lg leading-tight">Trixty AI Agent</h4>
                <p className="text-[11px] text-blue-400/80 font-mono mt-1 flex items-center gap-1">
                  <Lock size={10} strokeWidth={1.5} /> {t('agent.profile.protected')}
                </p>
                <p className="text-[12px] text-[#777] mt-2 leading-relaxed">
                  {t('agent.profile.protected_desc')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
               <div className="space-y-2">
                 <label className="text-[10px] text-[#555] font-bold uppercase tracking-widest">{t('agent.profile.identity_label')}</label>
                 <div className="p-4 bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl text-[12px] text-[#999] font-mono whitespace-pre-wrap overflow-y-auto scrollbar-thin">
                   {identity}
                 </div>
               </div>
               <div className="space-y-2">
                 <label className="text-[10px] text-[#555] font-bold uppercase tracking-widest">{t('agent.profile.soul_label')}</label>
                 <div className="p-4 bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl text-[12px] text-[#999] font-mono whitespace-pre-wrap h-64 overflow-y-auto scrollbar-thin">
                   {soul}
                 </div>
               </div>
            </div>
          </div>
        );
      case 'manual':
        return (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h4 id="agent-manual-title" className="text-sm font-semibold text-white">AGENTS.md</h4>
                <p id="agent-manual-desc" className="text-[11px] text-[#555]">{t('agent.manual.desc')}</p>
              </div>
              <button
                onClick={() => handleSave('AGENTS.md')}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-1.5 bg-white text-black text-[11px] font-bold rounded-lg hover:bg-white/90 transition-all disabled:opacity-50"
              >
                {saveSuccess ? <CheckCircle2 size={14} strokeWidth={1.5} /> : (isSaving ? <RefreshCw size={14} strokeWidth={1.5} className="animate-spin" /> : <Save size={14} strokeWidth={1.5} />)}
                {saveSuccess ? t('agent.common.saved') : (isSaving ? t('agent.common.saving') : t('agent.common.save'))}
              </button>
            </div>
            <textarea
              aria-labelledby="agent-manual-title"
              aria-describedby="agent-manual-desc"
              value={localContent}
              onChange={(e) => setLocalContent(e.target.value)}
              className="w-full h-[400px] bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 text-[13px] text-[#ccc] font-mono focus:border-blue-500/50 outline-none scrollbar-thin resize-none"
              placeholder={t('agent.manual.placeholder')}
            />
          </div>
        );
      case 'design':
        return (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h4 id="agent-design-title" className="text-sm font-semibold text-white">DESIGN.md</h4>
                <p id="agent-design-desc" className="text-[11px] text-[#555]">{t('agent.design.desc')}</p>
              </div>
              <button
                onClick={() => handleSave('DESIGN.md')}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-1.5 bg-white text-black text-[11px] font-bold rounded-lg hover:bg-white/90 transition-all disabled:opacity-50"
              >
                {saveSuccess ? <CheckCircle2 size={14} strokeWidth={1.5} /> : (isSaving ? <RefreshCw size={14} strokeWidth={1.5} className="animate-spin" /> : <Save size={14} strokeWidth={1.5} />)}
                {saveSuccess ? t('agent.common.saved') : (isSaving ? t('agent.common.saving') : t('agent.common.save'))}
              </button>
            </div>
            <textarea
              aria-labelledby="agent-design-title"
              aria-describedby="agent-design-desc"
              value={localContent}
              onChange={(e) => setLocalContent(e.target.value)}
              className="w-full h-[400px] bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 text-[13px] text-[#ccc] font-mono focus:border-blue-500/50 outline-none scrollbar-thin resize-none"
              placeholder={t('agent.design.placeholder')}
            />
          </div>
        );
      case 'user':
        return (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h4 id="agent-user-title" className="text-sm font-semibold text-white">USER.md</h4>
                <p id="agent-user-desc" className="text-[11px] text-[#555]">{t('agent.user.desc')}</p>
              </div>
              <button
                onClick={() => handleSave('USER.md')}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-1.5 bg-white text-black text-[11px] font-bold rounded-lg hover:bg-white/90 transition-all disabled:opacity-50"
              >
                {saveSuccess ? <CheckCircle2 size={14} strokeWidth={1.5} /> : (isSaving ? <RefreshCw size={14} strokeWidth={1.5} className="animate-spin" /> : <Save size={14} strokeWidth={1.5} />)}
                {saveSuccess ? t('agent.common.saved') : (isSaving ? t('agent.common.saving') : t('agent.common.save'))}
              </button>
            </div>
            <textarea
              aria-labelledby="agent-user-title"
              aria-describedby="agent-user-desc"
              value={localContent}
              onChange={(e) => setLocalContent(e.target.value)}
              className="w-full h-[400px] bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 text-[13px] text-[#ccc] font-mono focus:border-blue-500/50 outline-none scrollbar-thin resize-none"
              placeholder={t('agent.user.placeholder')}
            />
          </div>
        );
      case 'skills':
        return (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h4 className="text-sm font-semibold text-white mb-2">{t('agent.skills.title')}</h4>
            <div className="grid grid-cols-1 gap-2">
              {skills.length === 0 ? (
                <div className="p-10 border border-dashed border-[#222] rounded-2xl flex flex-col items-center justify-center text-center">
                  <Sparkles size={32} strokeWidth={1.5} className="text-[#222] mb-3" />
                  <p className="text-[11px] text-[#444]">{t('agent.skills.none')}</p>
                </div>
              ) : (
                skills.map(skill => (
                  <div 
                    key={skill.id}
                    onClick={() => toggleSkill(skill.id)}
                    className={`p-4 border rounded-xl flex items-center justify-between cursor-pointer transition-all ${
                      activeSkills.includes(skill.id) 
                        ? "bg-blue-500/10 border-blue-500/30" 
                        : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-colors ${
                        activeSkills.includes(skill.id) ? "bg-blue-500/20 border-blue-500/30 text-blue-400" : "bg-[#111] border-white/5 text-[#444]"
                      }`}>
                        <Sparkles size={18} strokeWidth={1.5} />
                      </div>
                      <div>
                        <h5 className={`text-[13px] font-bold ${activeSkills.includes(skill.id) ? "text-white" : "text-[#777]"}`}>{skill.name}</h5>
                        <p className="text-[11px] text-[#555]">{skill.description}</p>
                      </div>
                    </div>
                    <div className={`w-10 h-5 rounded-full relative transition-colors ${
                      activeSkills.includes(skill.id) ? "bg-blue-500" : "bg-[#222]"
                    }`}>
                      <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${
                        activeSkills.includes(skill.id) ? "left-6" : "left-1"
                      }`} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      case 'documentations':
        return (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h4 className="text-sm font-semibold text-white mb-2">{t('agent.documentations.title')}</h4>
            <div className="grid grid-cols-1 gap-2">
              {docs.length === 0 ? (
                <div className="p-10 border border-dashed border-[#222] rounded-2xl flex flex-col items-center justify-center text-center">
                  <BookOpen size={32} strokeWidth={1.5} className="text-[#222] mb-3" />
                  <p className="text-[11px] text-[#444]">{t('agent.documentations.none')}</p>
                </div>
              ) : (
                docs.map(doc => (
                  <div 
                    key={doc.id}
                    onClick={() => toggleDoc(doc.id)}
                    className={`p-4 border rounded-xl flex items-center justify-between cursor-pointer transition-all ${
                      activeDocs.includes(doc.id) 
                        ? "bg-blue-500/10 border-blue-500/30" 
                        : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-colors ${
                        activeDocs.includes(doc.id) ? "bg-blue-500/20 border-blue-500/30 text-blue-400" : "bg-[#111] border-white/5 text-[#444]"
                      }`}>
                        <BookOpen size={18} strokeWidth={1.5} />
                      </div>
                      <div>
                        <h5 className={`text-[13px] font-bold ${activeDocs.includes(doc.id) ? "text-white" : "text-[#777]"}`}>{doc.name}</h5>
                        <p className="text-[11px] text-[#555]">{doc.description}</p>
                      </div>
                    </div>
                    <div className={`w-10 h-5 rounded-full relative transition-colors ${
                      activeDocs.includes(doc.id) ? "bg-blue-500" : "bg-[#222]"
                    }`}>
                      <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${
                        activeDocs.includes(doc.id) ? "left-6" : "left-1"
                      }`} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      case 'configuration':
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="space-y-6 max-w-lg">
              {/* Keep Alive Setting */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label htmlFor="agent-config-keepalive" className="text-[11px] font-bold text-[#888] uppercase tracking-wider">{t('agent.configuration.keepalive_label')}</label>
                  <span className="text-[11px] font-mono text-blue-400 font-bold bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                    {aiSettings.keepAlive || 5} {t('agent.configuration.keepalive_unit')}
                  </span>
                </div>
                <input
                  id="agent-config-keepalive"
                  type="range"
                  min="5"
                  max="1440"
                  step="5"
                  value={aiSettings.keepAlive || 5}
                  onChange={(e) => updateAISettings({ keepAlive: parseInt(e.target.value) })}
                  aria-describedby="agent-config-keepalive-desc"
                  aria-valuetext={`${aiSettings.keepAlive || 5} ${t('agent.configuration.keepalive_unit')}`}
                  className="w-full h-1.5 bg-[#1a1a1a] rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <div aria-hidden="true" className="flex justify-between text-[10px] text-[#444] font-mono">
                  <span>5m</span>
                  <span>12h</span>
                  <span>24h</span>
                </div>
                <p id="agent-config-keepalive-desc" className="text-[11px] text-[#666]">{t('agent.configuration.keepalive_desc')}</p>
                
                <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl flex gap-3">
                   <AlertCircle size={16} strokeWidth={1.5} className="text-amber-500 shrink-0 mt-0.5" />
                   <p className="text-[11px] text-amber-500/80 leading-relaxed italic">
                     {t('agent.configuration.keepalive_warning')}
                   </p>
                </div>
              </div>

              <div className="h-px bg-white/5" />

              {/* Startup Pre-load Setting */}
              <div className="space-y-4">
                <div className="flex items-center justify-between group">
                  <div className="flex flex-col gap-1">
                    <label className="text-[12px] font-bold text-white tracking-tight">{t('agent.configuration.loadonstartup_label')}</label>
                    <p className="text-[11px] text-[#555] max-w-sm">{t('agent.configuration.loadonstartup_desc')}</p>
                  </div>
                  <button
                    onClick={() => updateAISettings({ loadOnStartup: !aiSettings.loadOnStartup })}
                    className={`w-12 h-6 rounded-full relative transition-all duration-300 ${
                      aiSettings.loadOnStartup ? "bg-blue-600 shadow-lg shadow-blue-900/40" : "bg-[#1a1a1a] border border-white/5"
                    }`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-300 ${
                      aiSettings.loadOnStartup ? "left-7" : "left-1"
                    }`} />
                  </button>
                </div>

                <div className="p-4 bg-amber-500/[0.03] border border-amber-500/10 rounded-2xl flex gap-4 backdrop-blur-sm relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-br from-amber-500/[0.05] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center border border-amber-500/10 shrink-0 relative z-10 shadow-inner">
                    <AlertTriangle size={18} strokeWidth={1.5} className="text-amber-500/70" />
                  </div>
                  <div className="relative z-10 flex items-center">
                    <h5 className="text-[12px] font-bold text-amber-500/90 tracking-tight leading-tight">
                      {t('agent.configuration.loadonstartup_warning')}
                    </h5>
                  </div>
                </div>
              </div>

              <div className="h-px bg-white/5" />

              {/* Inline code suggestions (issue #258). Off by default —
                  every keystroke can hit Ollama, so the user opts in
                  explicitly. Falls back to the chat-selected model when
                  no override is provided. */}
              <div className="space-y-4">
                <div className="flex items-center justify-between group">
                  <div className="flex flex-col gap-1">
                    <label className="text-[12px] font-bold text-white tracking-tight">
                      Inline code suggestions
                    </label>
                    <p className="text-[11px] text-[#555] max-w-sm">
                      Ghost-text completions in the editor powered by Ollama (FIM).
                      Tab accepts, Esc dismisses.
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      updateAISettings({
                        inlineCompletions: {
                          ...aiSettings.inlineCompletions,
                          enabled: !aiSettings.inlineCompletions.enabled,
                        },
                      })
                    }
                    className={`w-12 h-6 rounded-full relative transition-all duration-300 ${
                      aiSettings.inlineCompletions.enabled
                        ? "bg-blue-600 shadow-lg shadow-blue-900/40"
                        : "bg-[#1a1a1a] border border-white/5"
                    }`}
                    aria-pressed={aiSettings.inlineCompletions.enabled}
                  >
                    <div
                      className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-300 ${
                        aiSettings.inlineCompletions.enabled ? "left-7" : "left-1"
                      }`}
                    />
                  </button>
                </div>

                {aiSettings.inlineCompletions.enabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="inline-completions-model"
                        className="text-[10px] text-[#888] uppercase tracking-wider"
                      >
                        Model override
                      </label>
                      <input
                        id="inline-completions-model"
                        type="text"
                        placeholder="qwen2.5-coder:7b (chat model if empty)"
                        value={aiSettings.inlineCompletions.model}
                        onChange={(e) =>
                          updateAISettings({
                            inlineCompletions: {
                              ...aiSettings.inlineCompletions,
                              model: e.target.value,
                            },
                          })
                        }
                        className="bg-[#0a0a0a] border border-[#1a1a1a] rounded px-2 py-1.5 text-[12px] text-white focus:border-blue-500/50 outline-none transition-colors"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="inline-completions-debounce"
                        className="text-[10px] text-[#888] uppercase tracking-wider"
                      >
                        Debounce (ms)
                      </label>
                      <input
                        id="inline-completions-debounce"
                        type="number"
                        min={50}
                        max={2000}
                        step={50}
                        value={aiSettings.inlineCompletions.debounceMs}
                        onChange={(e) => {
                          const val = e.target.valueAsNumber;
                          if (Number.isFinite(val) && val >= 50) {
                            updateAISettings({
                              inlineCompletions: {
                                ...aiSettings.inlineCompletions,
                                debounceMs: val,
                              },
                            });
                          }
                        }}
                        className="bg-[#0a0a0a] border border-[#1a1a1a] rounded px-2 py-1.5 text-[12px] text-white focus:border-blue-500/50 outline-none transition-colors"
                      />
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        );
      case 'memory':
        return (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h4 id="agent-memory-title" className="text-sm font-semibold text-white">MEMORY.md</h4>
                <p id="agent-memory-desc" className="text-[11px] text-[#555]">{t('agent.memory.desc')}</p>
              </div>
            </div>
            <textarea
              aria-labelledby="agent-memory-title"
              aria-describedby="agent-memory-desc"
              value={memory || ""}
              readOnly
              className="w-full h-[400px] bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 text-[13px] text-[#555] font-mono focus:border-blue-500/50 outline-none scrollbar-thin resize-none cursor-default"
              placeholder={t('agent.memory.none', { defaultValue: "No data in long-term memory yet." })}
            />
          </div>
        );
    }
  };

  return (
    <div className="min-h-[500px]">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <RefreshCw size={24} className="animate-spin text-blue-500/50" />
          <p className="text-[10px] text-[#444] font-bold uppercase tracking-widest">{t('common.loading')}</p>
        </div>
      ) : renderTabContent()}
    </div>
  );
};

export default AgentSettings;
