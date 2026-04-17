"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  Languages,
  Brain,
  Palette,
  ChevronRight,
  ChevronLeft,
  Rocket,
  Download,
  AlertCircle,
  Minus,
  Square,
  X,
  Copy,
  Check,
  Loader2,
  Settings2
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/context/AppContext";
import { useL10n } from "@/hooks/useL10n";
import { safeInvoke as invoke } from "@/api/tauri";

const steps = [
  { id: "welcome", title: "onboarding.welcome", icon: Sparkles, color: "text-blue-400" },
  { id: "language", title: "onboarding.language", icon: Languages, color: "text-yellow-400" },
  { id: "ai", title: "onboarding.ai", icon: Brain, color: "text-purple-400" },
  { id: "general", title: "onboarding.appearance", icon: Settings2, color: "text-pink-400" },
  { id: "finish", title: "onboarding.finish", icon: Rocket, color: "text-orange-400" }
];

const OnboardingWizard: React.FC = () => {
  const {
    locale,
    setLocale,
    aiSettings,
    editorSettings,
    updateEditorSettings,
    systemSettings,
    updateSystemSettings,
  } = useApp();
  const { t } = useL10n();
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(0);
  const [isVerifyingOllama, setIsVerifyingOllama] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<"idle" | "success" | "error">("idle");
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMinimize = () => getCurrentWindow().minimize();
  const handleMaximize = async () => {
    await getCurrentWindow().toggleMaximize();
    const maximized = await getCurrentWindow().isMaximized();
    setIsMaximized(maximized);
  };
  const handleClose = () => getCurrentWindow().close();

  useEffect(() => {
    const unlisten = getCurrentWindow().onResized(async () => {
      const maximized = await getCurrentWindow().isMaximized();
      setIsMaximized(maximized);
    });
    return () => {
      unlisten.then(u => u());
    };
  }, []);

  const checkOllama = useCallback(async () => {
    setIsVerifyingOllama(true);
    try {
      const result = await invoke("ollama_proxy", {
        method: "GET",
        url: `${aiSettings.endpoint}/api/tags`,
        body: { type: "tags" }
      });
      if (result.status === 200) {
        setOllamaStatus("success");
      } else {
        setOllamaStatus("error");
      }
    } catch (e) {
      setOllamaStatus("error");
    } finally {
      setIsVerifyingOllama(false);
    }
  }, [aiSettings.endpoint]);

  useEffect(() => {
    if (currentStep === 2) {
      checkOllama();
    }
  }, [currentStep, checkOllama]);

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setDirection(1);
      setCurrentStep(prev => prev + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setDirection(-1);
      setCurrentStep(prev => prev - 1);
    }
  };

  const finish = () => {
    updateSystemSettings({ hasCompletedOnboarding: true });
  };

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 50 : -50,
      opacity: 0,
      filter: "blur(10px)",
      scale: 0.98
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
      filter: "blur(0px)",
      scale: 1
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? 50 : -50,
      opacity: 0,
      filter: "blur(10px)",
      scale: 0.98
    })
  };

  const stepThemes = [
    { color: "rgba(59, 130, 246, 0.4)" }, // Blue (Welcome)
    { color: "rgba(234, 179, 8, 0.4)" },   // Yellow (Language)
    { color: "rgba(168, 85, 247, 0.4)" },  // Purple (AI)
    { color: "rgba(236, 72, 153, 0.4)" },  // Pink (Appearance)
    { color: "rgba(249, 115, 22, 0.4)" }   // Orange (Finish)
  ];

  if (systemSettings.hasCompletedOnboarding) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center p-6 overflow-hidden text-white">
      {/* Absolute Window Header (Top-level) */}
      <div className="absolute top-0 left-0 right-0 h-10 flex items-center justify-end px-4 z-[120]" data-tauri-drag-region>
        <div data-tauri-no-drag className="flex items-center gap-1">
          <button onClick={handleMinimize} className="h-8 w-8 flex items-center justify-center hover:bg-white/5 rounded-lg transition-colors text-white/20 hover:text-white"><Minus size={14} /></button>
          <button onClick={handleMaximize} className="h-8 w-8 flex items-center justify-center hover:bg-white/5 rounded-lg transition-colors text-white/20 hover:text-white">{isMaximized ? <Copy size={12} /> : <Square size={12} />}</button>
          <button onClick={handleClose} className="h-8 w-8 flex items-center justify-center hover:bg-red-500/80 hover:text-white rounded-lg transition-colors text-white/20 hover:text-white"><X size={14} /></button>
        </div>
      </div>

      {/* Main Studio Container */}
      <div className="relative w-full max-w-4xl h-[640px] bg-[#0c0c0c] border border-white/5 rounded-2xl overflow-hidden flex shadow-2xl">

        {/* Left Sidebar Navigator */}
        <div className="w-64 border-r border-white/5 bg-[#080808] flex flex-col p-8 select-none" data-tauri-drag-region>
          <div className="flex items-center gap-3 mb-10 opacity-80 pointer-events-none">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-900/20">
              <Sparkles size={18} className="text-white" />
            </div>
            <span className="font-bold tracking-tight text-white/90">Trixty IDE</span>
          </div>

          <nav className="flex-1 space-y-2">
            {steps.map((step, idx) => {
              const isActive = idx === currentStep;
              const isCompleted = idx < currentStep;
              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-300 ${isActive ? "bg-white/[0.05] text-white" : "text-white/30"
                    }`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all ${isActive ? "border-blue-500 text-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" :
                      isCompleted ? "border-green-500 bg-green-500 text-black border-green-500" : "border-white/10"
                    }`}>
                    {isCompleted ? "✓" : idx + 1}
                  </div>
                  <span className={`text-[11px] font-bold uppercase tracking-widest ${isActive ? "opacity-100" : "opacity-60"}`}>
                    {t(step.title)}
                  </span>
                </div>
              );
            })}
          </nav>

        </div>

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col relative bg-[#0c0c0c]">

          {/* Main Form Area */}
          <div className="flex-1 overflow-hidden relative">
            <AnimatePresence initial={false} custom={direction} mode="wait">
              <motion.div
                key={currentStep}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  x: { type: "spring", stiffness: 300, damping: 30 },
                  opacity: { duration: 0.2 }
                }}
                className="absolute inset-0 px-16 py-8 flex flex-col"
              >
                {currentStep === 0 && (
                  <div className="space-y-6 pt-10">
                    <h1 className="text-4xl font-bold text-white tracking-tight">
                      {t('onboarding.welcome.title')}
                    </h1>
                    <p className="text-white/40 text-lg leading-relaxed max-w-md font-medium">
                      {t('onboarding.welcome.subtitle')}
                    </p>

                  </div>
                )}

                {currentStep === 1 && (
                  <div className="space-y-10 w-full max-w-lg pt-4">
                    <div className="space-y-2">
                      <h2 className="text-2xl font-bold text-white tracking-tight">{t('onboarding.language.title')}</h2>
                      <p className="text-white/40 text-sm font-medium">{t('onboarding.language.subtitle')}</p>
                    </div>

                    <div className="space-y-3">
                      {[
                        { id: "en", label: "English", native: "US English", icon: "🇺🇸" },
                        { id: "es", label: "Español", native: "Spanish", icon: "🇪🇸" }
                      ].map((lang) => (
                        <button
                          key={lang.id}
                          onClick={() => setLocale(lang.id)}
                          className={`w-full p-4 rounded-xl border flex items-center justify-between transition-all group ${locale === lang.id
                              ? "bg-white/[0.05] border-white/20 shadow-lg"
                              : "bg-transparent border-white/5 hover:border-white/10 hover:bg-white/[0.02]"
                            }`}
                        >
                          <div className="flex items-center gap-4">
                            <span className="text-2xl grayscale group-hover:grayscale-0 transition-all">{lang.icon}</span>
                            <div className="text-left">
                              <p className={`font-bold text-sm ${locale === lang.id ? "text-white" : "text-white/60"}`}>{lang.label}</p>
                              <p className="text-[10px] text-white/20 font-bold uppercase tracking-widest">{lang.native}</p>
                            </div>
                          </div>
                          {locale === lang.id && (
                            <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                              <Check size={12} className="text-white font-bold" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="space-y-10 w-full max-w-lg pt-4">
                    <div className="space-y-2">
                      <h2 className="text-2xl font-bold text-white tracking-tight">{t('onboarding.ai.title')}</h2>
                      <p className="text-white/40 text-sm font-medium">{t('onboarding.ai.subtitle')}</p>
                    </div>

                    <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/5 space-y-8">
                      <div className="flex items-center gap-6">
                        <div className={`w-14 h-14 rounded-xl flex items-center justify-center transition-colors ${ollamaStatus === "success" ? "bg-green-500/20" : "bg-white/5"}`}>
                          {isVerifyingOllama ? <Loader2 size={24} className="animate-spin text-white/20" /> : <Brain size={24} className={ollamaStatus === "success" ? "text-green-500" : "text-white/10"} />}
                        </div>
                        <div className="flex-1">
                          <p className="text-[10px] font-black text-white/20 uppercase tracking-widest">{t('onboarding.ai.status.label')}</p>
                          <p className={`text-lg font-bold ${ollamaStatus === "success" ? "text-green-500" : "text-white/40"}`}>
                            {isVerifyingOllama ? t('onboarding.ai.status.verifying') : ollamaStatus === "success" ? t('onboarding.ai.status.connected') : t('onboarding.ai.status.not_found')}
                          </p>
                        </div>
                      </div>

                      {ollamaStatus !== "success" && (
                        <div className="flex gap-3">
                          <button onClick={checkOllama} className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-white/5 transition-all">{t('ai.check_updates')}</button>
                          <a href="https://ollama.com/download" target="_blank" className="flex-1 py-3 bg-white text-black hover:bg-white/90 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all">
                            <Download size={14} /> {t('onboarding.ai.status.download')}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {currentStep === 3 && (
                  <div className="space-y-8 w-full max-w-lg pt-4">
                    <div className="space-y-2">
                      <h2 className="text-2xl font-bold text-white tracking-tight">{t('onboarding.appearance.title')}</h2>
                      <p className="text-white/40 text-sm font-medium">{t('onboarding.appearance.subtitle')}</p>
                    </div>

                    <div className="space-y-8">
                      <div className="bg-[#080808] border border-white/5 rounded-2xl p-8 font-mono shadow-inner group relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1 bg-blue-500/40 h-full" />
                        <div style={{ fontSize: `${editorSettings.fontSize}px`, lineHeight: `${editorSettings.lineHeight}px` }} className="text-white/90">
                          <span className="text-purple-400">const</span> trixty = <span className="text-blue-400">"Modern IDE"</span>;
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-3">
                          <label className="text-[10px] font-black text-white/20 uppercase tracking-widest">{t('onboarding.appearance.font_size')}</label>
                          <div className="flex items-center gap-3">
                            <button onClick={() => updateEditorSettings({ fontSize: Math.max(10, editorSettings.fontSize - 1) })} className="w-10 h-10 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center hover:bg-white/10 transition-all">-</button>
                            <span className="w-8 text-center font-bold text-white tabular-nums">{editorSettings.fontSize}</span>
                            <button onClick={() => updateEditorSettings({ fontSize: Math.min(30, editorSettings.fontSize + 1) })} className="w-10 h-10 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center hover:bg-white/10 transition-all">+</button>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <label className="text-[10px] font-black text-white/20 uppercase tracking-widest">{t('onboarding.appearance.line_height')}</label>
                          <div className="flex items-center gap-3">
                            <button onClick={() => updateEditorSettings({ lineHeight: Math.max(10, editorSettings.lineHeight - 2) })} className="w-10 h-10 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center hover:bg-white/10 transition-all">-</button>
                            <span className="w-8 text-center font-bold text-white tabular-nums">{editorSettings.lineHeight}</span>
                            <button onClick={() => updateEditorSettings({ lineHeight: Math.min(50, editorSettings.lineHeight + 2) })} className="w-10 h-10 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center hover:bg-white/10 transition-all">+</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {currentStep === 4 && (
                  <div className="space-y-8 pt-10">
                    <div className="w-20 h-20 bg-blue-600/10 rounded-[24px] flex items-center justify-center border border-blue-500/20 mb-6">
                      <Rocket size={40} className="text-blue-500" />
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-4xl font-bold text-white tracking-tight">{t('onboarding.finish.title')}</h2>
                      <p className="text-white/40 text-lg font-medium leading-relaxed max-w-sm font-semibold">
                        {t('onboarding.finish.subtitle')}
                      </p>
                    </div>
                    <div className="flex gap-2 pt-4">
                      <div className="px-3 py-1 bg-white/5 rounded-full text-[10px] font-bold text-white/40 border border-white/5 uppercase tracking-widest">{t('onboarding.finish.config_set')}</div>
                      <div className="px-3 py-1 bg-white/5 rounded-full text-[10px] font-bold text-white/40 border border-white/5 uppercase tracking-widest">{t('onboarding.finish.ready')}</div>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Persistent Studio Footer */}
          <div className="h-24 border-t border-white/5 px-16 flex items-center justify-between bg-[#0b0b0b]">
            <button
              onClick={prevStep}
              className={`text-[10px] font-black uppercase tracking-[0.2em] transition-all ${currentStep === 0 ? "opacity-0 pointer-events-none" : "text-white/20 hover:text-white"
                }`}
            >
              {t('common.prev')}
            </button>
            <button
              onClick={currentStep === steps.length - 1 ? finish : nextStep}
              className="px-8 py-3 bg-white text-black text-[10px] font-black uppercase tracking-[0.2em] rounded-lg hover:bg-white/90 active:scale-95 transition-all shadow-xl shadow-black/20"
            >
              {currentStep === steps.length - 1 ? t('onboarding.finish.launch') : t('common.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingWizard;
