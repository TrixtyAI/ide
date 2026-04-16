import * as builtinAiAssistant from "@/addons/builtin.ai-assistant/index";
import * as builtinGitExplorer from "@/addons/builtin.git-explorer/index";
import { registerBuiltinTranslations } from "./builtin.l10n";

export class PluginManager {
    static async bootstrap() {
        console.log("[PluginManager] Bootstrapping built-in extensions and localizations...");
        
        // Load translations first
        registerBuiltinTranslations();

        try {
            builtinAiAssistant.activate();
            console.log("[PluginManager] builtin.ai-assistant activated.");
        } catch (e) {
            console.error("Failed to activate AI assistant", e);
        }

        try {
            builtinGitExplorer.activate();
            console.log("[PluginManager] builtin.git-explorer activated.");
        } catch (e) {
            console.error("Failed to activate Git Explorer", e);
        }

        // Dynamically load external scripts from Tauri File System
        try {
            await this.loadExternalAddons();
        } catch (e) {
            console.error("Failed to load external addons", e);
        }
    }

    private static async loadExternalAddons() {
        const { safeInvoke: invoke } = await import('@/api/tauri');
        
        console.log("[PluginManager] Scanning for installed third-party extensions...");
        const installed = await invoke<string[]>("get_installed_extensions");
        
        for (const ext_id of installed) {
            const isActive = await invoke<boolean>("is_extension_active", { id: ext_id });
            if (isActive) {
                console.log(`[PluginManager] Loading external addon: ${ext_id}`);
                try {
                    const scriptStr = await invoke<string>("read_extension_script", { id: ext_id });
                    
                    // Emulate a CommonJS Module Sandbox
                    const moduleContext = { exports: {} as any };
                    // We supply React and trixty as arguments to the Function enclosure safely
                    const runner = new Function('module', 'exports', 'React', 'trixty', scriptStr);
                    
                    // Evaluate in the Webview JS Engine context
                    // @ts-ignore
                    runner(moduleContext, moduleContext.exports, window.React, window.trixty);
                    
                    if (typeof moduleContext.exports.activate === 'function') {
                        // @ts-ignore
                        moduleContext.exports.activate(window.trixty);
                        console.log(`[PluginManager] Addon ${ext_id} activated successfully!`);
                    } else {
                        console.warn(`[PluginManager] Addon ${ext_id} executed but exported no 'activate' function.`);
                    }
                } catch (err) {
                    console.error(`[PluginManager] Error evaluating addon ${ext_id}:`, err);
                }
            } else {
                console.log(`[PluginManager] Skipping ${ext_id} (Disabled)`);
            }
        }
    }
}
