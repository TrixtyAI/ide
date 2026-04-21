import React from "react";
import { loader, type Monaco } from "@monaco-editor/react";
import type { languages } from "monaco-editor";
import { logger } from "@/lib/logger";

// Registry of all available commands in the IDE. 
// Can be extended via Declaration Merging in other modules.
export interface TrixtyCommands {
    'ai.suggestChanges': (prompt: string) => Promise<string>;
    'editor.format': () => void;
    // Add more command signatures here or in other files using:
    // declare module "@/api/trixty" { interface TrixtyCommands { 'my.cmd': () => void } }
}

type CommandCallback = (...args: never[]) => unknown;

class CommandRegistry {
    private commands = new Map<string, CommandCallback>();

    registerCommand<K extends keyof TrixtyCommands>(id: K, callback: TrixtyCommands[K]) {
        if (this.commands.has(id)) {
            logger.warn(`Command ${id} is already registered. Overwriting.`);
        }
        this.commands.set(id, callback as unknown as CommandCallback);
    }

    executeCommand<K extends keyof TrixtyCommands>(id: K, ...args: Parameters<TrixtyCommands[K]>): ReturnType<TrixtyCommands[K]> {
        const cmd = this.commands.get(id);
        if (!cmd) {
            throw new Error(`Command ${id} not found.`);
        }
        // Using uncurried cast to solve the never[] spread issue
        return (cmd as unknown as (...a: Parameters<TrixtyCommands[K]>) => ReturnType<TrixtyCommands[K]>)(...args);
    }
}

export interface WebviewView {
    id: string;
    title: string;
    icon: React.ReactNode;
    render: () => React.ReactNode;
}

class WindowRegistry {
    private rightPanelViews = new Map<string, WebviewView>();
    private leftPanelViews = new Map<string, WebviewView>();

    // Listeners for React to re-render when new views are registered
    private listeners = new Set<() => void>();

    private notify() {
        for (const listener of this.listeners) listener();
    }

    subscribe = (listener: () => void): () => void => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    registerRightPanelView(view: WebviewView) {
        this.rightPanelViews.set(view.id, view);
        this.notify();
    }

    registerLeftPanelView(view: WebviewView) {
        this.leftPanelViews.set(view.id, view);
        this.notify();
    }

    getRightPanelViews(): WebviewView[] {
        return Array.from(this.rightPanelViews.values());
    }

    getLeftPanelViews(): WebviewView[] {
        return Array.from(this.leftPanelViews.values());
    }

    showInformationMessage(msg: string) {
        logger.debug(`[Trixty Info] ${msg}`);
        window.dispatchEvent(new CustomEvent('trixty-flash', { detail: msg }));
    }
}

class L10nRegistry {
    private bundles = new Map<string, Record<string, string>>();
    private currentLocale = 'en';
    private listeners = new Set<() => void>();
    private version = 0;
    private snapshot = { locale: 'en', version: 0 };

    registerTranslations(locale: string, bundle: Record<string, string>) {
        const existing = this.bundles.get(locale) || {};
        this.bundles.set(locale, { ...existing, ...bundle });
        this.notify();
    }

    setLocale(locale: string) {
        this.currentLocale = locale;
        this.notify();
    }

    getLocale() {
        return this.currentLocale;
    }

    t(key: string, params?: Record<string, string>): string {
        const bundle = this.bundles.get(this.currentLocale) || this.bundles.get('en') || {};
        let text = bundle[key] || key;

        if (params) {
            Object.entries(params).forEach(([k, v]) => {
                text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
            });
        }
        return text;
    }

    subscribe = (listener: () => void): () => void => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    getSnapshot = () => {
        return this.snapshot;
    }

    private notify() {
        this.version++;
        this.snapshot = { locale: this.currentLocale, version: this.version };
        for (const listener of this.listeners) listener();
    }
}

class LanguageRegistry {
  private monaco: Monaco | null = null;
  private buffer: Array<
    | { type: 'register'; data: languages.ILanguageExtensionPoint }
    | { type: 'tokens'; data: { id: string; rules: languages.IMonarchLanguage } }
    | { type: 'config'; data: { id: string; config: languages.LanguageConfiguration } }
    | { type: 'indent'; data: { id: string; options: { tabSize: number; insertSpaces: boolean } } }
  > = [];
    private indentationSettings = new Map<string, { tabSize: number, insertSpaces: boolean }>();
    private extensionMap = new Map<string, string>(); // ext -> languageId

    constructor() {
        if (typeof window !== 'undefined') {
            loader.init().then(instance => {
                this.monaco = instance;
                logger.debug("[LanguageRegistry] Monaco instance initialized. Flushing buffer...");
                this.flush();
            }).catch(logger.error);
        }
    }

    private flush() {
        if (!this.monaco) return;
      for (const item of this.buffer) {
            try {
                if (item.type === 'register') {
                    this.monaco.languages.register(item.data);
                } else if (item.type === 'tokens') {
                    this.monaco.languages.setMonarchTokensProvider(item.data.id, item.data.rules);
                } else if (item.type === 'config') {
                    this.monaco.languages.setLanguageConfiguration(item.data.id, item.data.config);
                } else if (item.type === 'indent') {
                    this.indentationSettings.set(item.data.id, item.data.options);
                }
            } catch (e) {
                logger.error("[LanguageRegistry] Error flushing buffered language item:", e);
            }
        }
      logger.debug(`[LanguageRegistry] Flushed ${this.buffer.length} items to Monaco.`);
      this.buffer = [];
    }

    register(language: languages.ILanguageExtensionPoint) {
        logger.debug(`[LanguageRegistry] Registering language: ${language.id}`, language.extensions);
        if (language.extensions) {
            language.extensions.forEach(ext => {
                // Normalize extension (remove leading dot if present)
                const normalized = ext.startsWith('.') ? ext.substring(1) : ext;
                this.extensionMap.set(normalized, language.id);
            });
        }

        if (this.monaco) {
            this.monaco.languages.register(language);
        } else {
            logger.debug(`[LanguageRegistry] Monaco not ready, buffering registration for ${language.id}`);
            this.buffer.push({ type: 'register', data: language });
        }
    }

  setMonarchTokens(id: string, rules: languages.IMonarchLanguage) {
        logger.debug(`[LanguageRegistry] Setting Monarch tokens for: ${id}`);
        if (this.monaco) {
            this.monaco.languages.setMonarchTokensProvider(id, rules);
        } else {
            this.buffer.push({ type: 'tokens', data: { id, rules } });
        }
    }

  setConfiguration(id: string, config: languages.LanguageConfiguration) {
        if (this.monaco) {
            this.monaco.languages.setLanguageConfiguration(id, config);
        } else {
            this.buffer.push({ type: 'config', data: { id, config } });
        }
    }

    setIndentation(id: string, options: { tabSize: number, insertSpaces: boolean }) {
        this.indentationSettings.set(id, options);
        if (!this.monaco) {
            this.buffer.push({ type: 'indent', data: { id, options } });
        }
    }

    getIndentation(id: string) {
        return this.indentationSettings.get(id);
    }

    getLanguageByExtension(ext: string): string | undefined {
        const normalized = ext.startsWith('.') ? ext.substring(1) : ext;
        return this.extensionMap.get(normalized);
    }
}

class WorkspaceRegistry {
   // Placeholder for FS, Document Context context interactions
   fs = { // ... bridge to @tauri-apps/plugin-fs
   };
}

class AgentRegistry {
    private activeSkills = new Set<string>();
    private activeDocs = new Set<string>();
    private listeners = new Set<() => void>();

    private notify() {
        for (const listener of this.listeners) listener();
    }

    registerSkill(id: string) {
        this.activeSkills.add(id);
        this.notify();
    }

    unregisterSkill(id: string) {
        this.activeSkills.delete(id);
        this.notify();
    }

    getActiveSkills(): string[] {
        return Array.from(this.activeSkills);
    }

    registerDoc(id: string) {
        this.activeDocs.add(id);
        this.notify();
    }

    unregisterDoc(id: string) {
        this.activeDocs.delete(id);
        this.notify();
    }

    getActiveDocs(): string[] {
        return Array.from(this.activeDocs);
    }

    subscribe = (listener: () => void): () => void => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
}

export const trixty = {
    commands: new CommandRegistry(),
    window: new WindowRegistry(),
    workspace: new WorkspaceRegistry(),
    l10n: new L10nRegistry(),
    languages: new LanguageRegistry(),
    agent: new AgentRegistry()
};

// Global Window interface extensions for Trixty
declare global {
  interface Window {
    trixty: typeof trixty;
    React: typeof React;
    LucideIcons: typeof import("lucide-react");
    __TAURI_INTERNALS__?: unknown;
  }
}

// Make it globally available on the window object for dynamic parsed addons
if (typeof window !== "undefined") {
  window.trixty = trixty;
  window.React = React;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  window.LucideIcons = require("lucide-react");
}
