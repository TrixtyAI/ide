"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Plus, Trash2, ExternalLink, Check, ShieldCheck } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import type { ProviderId } from "@/context/SettingsContext";
import { PROVIDER_IDS, PROVIDERS } from "@/api/providers/registry";
import {
  type SecretProvider,
  getProviderSecret,
  setProviderSecret,
  clearProviderSecret,
} from "@/api/providerSecrets";

const CLOUD_PROVIDERS: ProviderId[] = PROVIDER_IDS.filter(
  (id) => PROVIDERS[id].kind === "cloud",
);

/**
 * Settings → Agent → Provider Keys (issue #267, hardened in this PR).
 *
 * Per-provider API key + curated model list. Keys are now stored in the
 * OS native keychain (macOS Keychain / Windows Credential Manager /
 * Linux Secret Service) instead of `settings.json` plaintext. The
 * settings file still owns the curated model list and the active
 * provider — only the secret material moved.
 */
export const ProviderKeysPanel: React.FC = () => {
  const { aiSettings, updateAISettings } = useSettings();
  const [revealedKey, setRevealedKey] = useState<ProviderId | null>(null);
  const [draftModels, setDraftModels] = useState<Record<string, string>>({});
  // Keys live in component state instead of `aiSettings.providerKeys`
  // — they're loaded once from the keychain on mount, mutated locally
  // as the user types, and persisted to the keychain on blur. The
  // settings file never sees the secret material.
  const [keys, setKeys] = useState<Partial<Record<SecretProvider, string>>>({});
  const [keyLoadDone, setKeyLoadDone] = useState(false);
  // Tracks which providers have a key stored in the keychain right now.
  // Mirrors the on-disk truth so the "Key set" pill stays accurate even
  // before the user has typed anything in this session.
  const [configured, setConfigured] = useState<Partial<Record<SecretProvider, boolean>>>({});

  // Load existing secrets on mount. We pull the full key (not just the
  // configured flag) because the input field needs to render the user's
  // existing value behind the reveal toggle.
  useEffect(() => {
    let alive = true;
    (async () => {
      const initial: Partial<Record<SecretProvider, string>> = {};
      const flags: Partial<Record<SecretProvider, boolean>> = {};
      for (const provider of CLOUD_PROVIDERS) {
        const secret = await getProviderSecret(provider as SecretProvider);
        initial[provider as SecretProvider] = secret;
        flags[provider as SecretProvider] = secret.length > 0;
      }
      if (!alive) return;
      setKeys(initial);
      setConfigured(flags);
      setKeyLoadDone(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Debounce keychain writes so a fast typer doesn't fire one IPC call
  // per keystroke. We commit on blur explicitly via `commitKey`, and
  // also on a 500 ms idle window so the user doesn't lose changes if
  // they navigate away mid-edit.
  const writeTimers = useRef<Partial<Record<SecretProvider, ReturnType<typeof setTimeout>>>>({});
  useEffect(() => {
    // Snapshot the ref so the cleanup runs against the same object the
    // effect set up, even if the ref is mutated again before unmount.
    const timersSnapshot = writeTimers.current;
    return () => {
      for (const handle of Object.values(timersSnapshot)) {
        if (handle) clearTimeout(handle);
      }
    };
  }, []);

  const setKey = (provider: ProviderId, value: string) => {
    if (provider === "ollama") return;
    const sp = provider as SecretProvider;
    setKeys((prev) => ({ ...prev, [sp]: value }));
    if (writeTimers.current[sp]) clearTimeout(writeTimers.current[sp]);
    writeTimers.current[sp] = setTimeout(() => {
      void persistKey(sp, value);
    }, 500);
  };

  const persistKey = async (provider: SecretProvider, value: string) => {
    if (value) {
      await setProviderSecret(provider, value);
      setConfigured((flags) => ({ ...flags, [provider]: true }));
    } else {
      await clearProviderSecret(provider);
      setConfigured((flags) => ({ ...flags, [provider]: false }));
    }
  };

  const commitKey = (provider: ProviderId) => {
    if (provider === "ollama") return;
    const sp = provider as SecretProvider;
    if (writeTimers.current[sp]) {
      clearTimeout(writeTimers.current[sp]);
      writeTimers.current[sp] = undefined;
    }
    void persistKey(sp, keys[sp] ?? "");
  };

  const addModel = (provider: ProviderId) => {
    const draft = (draftModels[provider] ?? "").trim();
    if (!draft) return;
    const existing = aiSettings.providerModels[provider] ?? [];
    if (existing.includes(draft)) {
      setDraftModels((d) => ({ ...d, [provider]: "" }));
      return;
    }
    updateAISettings({
      providerModels: {
        ...aiSettings.providerModels,
        [provider]: [...existing, draft],
      },
    });
    setDraftModels((d) => ({ ...d, [provider]: "" }));
  };

  const removeModel = (provider: ProviderId, model: string) => {
    const existing = aiSettings.providerModels[provider] ?? [];
    updateAISettings({
      providerModels: {
        ...aiSettings.providerModels,
        [provider]: existing.filter((m) => m !== model),
      },
    });
  };

  const renderedProviders = useMemo(() => CLOUD_PROVIDERS, []);

  return (
    <div className="space-y-10">
      <div className="p-4 bg-emerald-500/[0.04] border border-emerald-500/15 rounded-2xl text-[12px] text-emerald-200/85 leading-relaxed flex gap-3">
        <ShieldCheck size={16} strokeWidth={1.6} className="shrink-0 mt-[1px] text-emerald-300/80" />
        <span>
          Keys are stored in your OS native secret store — macOS Keychain,
          Windows Credential Manager, or Linux Secret Service / kwallet —
          and never written to <code className="font-mono">settings.json</code>.
        </span>
      </div>

      {renderedProviders.map((provider) => {
        const meta = PROVIDERS[provider];
        const sp = provider as SecretProvider;
        const key = keys[sp] ?? "";
        const isConfigured = configured[sp] ?? false;
        const models = aiSettings.providerModels[provider] ?? [];
        const isRevealed = revealedKey === provider;
        return (
          <section
            key={provider}
            className="space-y-4 border border-[#1a1a1a] rounded-2xl p-5 bg-[#0a0a0a]"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-[13px] font-bold text-white tracking-tight">
                  {meta.label}
                </h4>
                <a
                  href={meta.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-[#666] hover:text-blue-400 transition-colors mt-1 uppercase tracking-wider"
                >
                  <ExternalLink size={10} strokeWidth={1.6} />
                  Docs
                </a>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  isConfigured
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
                    : "bg-[#1a1a1a] text-[#555] border border-white/5"
                }`}
              >
                {isConfigured ? "Key set" : "No key"}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={`provider-key-${provider}`}
                className="text-[10px] font-bold text-[#888] uppercase tracking-wider"
              >
                API key
              </label>
              <div className="relative">
                <input
                  id={`provider-key-${provider}`}
                  type={isRevealed ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  onChange={(e) => setKey(provider, e.target.value)}
                  onBlur={() => commitKey(provider)}
                  disabled={!keyLoadDone}
                  placeholder={`Paste your ${meta.label} API key`}
                  className="w-full bg-[#0e0e0e] border border-[#1a1a1a] rounded-lg px-3 py-2 pr-10 text-[12px] text-white font-mono focus:border-blue-500/50 outline-none transition-colors disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setRevealedKey(isRevealed ? null : provider)}
                  title={isRevealed ? "Hide key" : "Reveal key"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#555] hover:text-white transition-colors"
                  aria-label={isRevealed ? "Hide API key" : "Reveal API key"}
                >
                  {isRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={`provider-model-input-${provider}`}
                  className="text-[10px] font-bold text-[#888] uppercase tracking-wider"
                >
                  Models
                </label>
                <span className="text-[10px] text-[#444] font-mono">
                  {models.length} entr{models.length === 1 ? "y" : "ies"}
                </span>
              </div>

              <div className="flex gap-2">
                <input
                  id={`provider-model-input-${provider}`}
                  type="text"
                  value={draftModels[provider] ?? ""}
                  onChange={(e) =>
                    setDraftModels((d) => ({ ...d, [provider]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addModel(provider);
                    }
                  }}
                  placeholder={meta.placeholderModel}
                  className="flex-1 bg-[#0e0e0e] border border-[#1a1a1a] rounded-lg px-3 py-2 text-[12px] text-white font-mono focus:border-blue-500/50 outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => addModel(provider)}
                  disabled={!(draftModels[provider] ?? "").trim()}
                  className="px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={12} strokeWidth={1.8} />
                  Add
                </button>
              </div>

              {models.length === 0 ? (
                <p className="text-[11px] text-[#555] italic">
                  No models added yet. Add the exact model IDs you want
                  available in the chat header.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5 pt-1">
                  {models.map((model) => (
                    <li
                      key={model}
                      className="inline-flex items-center gap-1.5 bg-[#0e0e0e] border border-[#1a1a1a] rounded-full pl-3 pr-1 py-1 text-[11px] font-mono text-[#ccc]"
                    >
                      <span>{model}</span>
                      <button
                        type="button"
                        onClick={() => removeModel(provider, model)}
                        title={`Remove ${model}`}
                        className="p-1 rounded-full text-[#666] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        aria-label={`Remove ${model}`}
                      >
                        <Trash2 size={11} strokeWidth={1.6} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        );
      })}

      <div className="flex items-center gap-2 text-[11px] text-emerald-400/80">
        <Check size={12} strokeWidth={1.8} />
        Changes save automatically.
      </div>
    </div>
  );
};

export default ProviderKeysPanel;
