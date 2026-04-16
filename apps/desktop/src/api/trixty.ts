import React from "react";
import { loader } from "@monaco-editor/react";

type CommandCallback = (...args: any[]) => any;

class CommandRegistry {
    private commands = new Map<string, CommandCallback>();

    registerCommand(id: string, callback: CommandCallback) {
        if (this.commands.has(id)) {
            console.warn(`Command ${id} is already registered. Overwriting.`);
        }
        this.commands.set(id, callback);
    }

    executeCommand(id: string, ...args: any[]): any {
        const cmd = this.commands.get(id);
        if (!cmd) {
            throw new Error(`Command ${id} not found.`);
        }
        return cmd(...args);
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

    subscribe(listener: () => void): () => void {
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
        console.log(`[Trixty Info] ${msg}`);
        window.dispatchEvent(new CustomEvent('trixty-flash', { detail: msg }));
    }
}

class L10nRegistry {
    private bundles = new Map<string, Record<string, string>>();
    private currentLocale = (typeof window !== 'undefined' ? localStorage.getItem('trixty-locale') || 'en' : 'en');
    private listeners = new Set<() => void>();

    registerTranslations(locale: string, bundle: Record<string, string>) {
        const existing = this.bundles.get(locale) || {};
        this.bundles.set(locale, { ...existing, ...bundle });
        this.notify();
    }

    setLocale(locale: string) {
        if (this.currentLocale === locale) return;
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

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private notify() {
        for (const listener of this.listeners) listener();
    }
}

class LanguageRegistry {
    private monaco: any = null;
    private buffer: Array<{ type: 'register' | 'tokens' | 'config' | 'indent', data: any }> = [];
    private indentationSettings = new Map<string, { tabSize: number, insertSpaces: boolean }>();

    constructor() {
        if (typeof window !== 'undefined') {
            loader.init().then(instance => {
                this.monaco = instance;
                this.flush();
            }).catch(console.error);
        }
    }

    private flush() {
        if (!this.monaco) return;
        while (this.buffer.length > 0) {
            const item = this.buffer.shift();
            if (!item) continue;
            
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
                console.error("[LanguageRegistry] Error flushing buffered language item:", e);
            }
        }
    }

    register(language: { id: string, extensions?: string[], aliases?: string[], mimetypes?: string[] }) {
        if (this.monaco) {
            this.monaco.languages.register(language);
        } else {
            this.buffer.push({ type: 'register', data: language });
        }
    }

    setMonarchTokens(id: string, rules: any) {
        if (this.monaco) {
            this.monaco.languages.setMonarchTokensProvider(id, rules);
        } else {
            this.buffer.push({ type: 'tokens', data: { id, rules } });
        }
    }

    setConfiguration(id: string, config: any) {
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
}

class WorkspaceRegistry {
   // Placeholder for FS, Document Context context interactions
   fs = { // ... bridge to @tauri-apps/plugin-fs
   };
}

export const trixty = {
    commands: new CommandRegistry(),
    window: new WindowRegistry(),
    workspace: new WorkspaceRegistry(),
    l10n: new L10nRegistry(),
    languages: new LanguageRegistry()
};

// Make it globally available on the window object for dynamic parsed addons
if (typeof window !== "undefined") {
    (window as any).trixty = trixty;
    (window as any).React = React;
    (window as any).LucideIcons = require("lucide-react");
}
