import * as builtinAiAssistant from "@/addons/builtin.ai-assistant/index";
import * as builtinGitExplorer from "@/addons/builtin.git-explorer/index";
import * as builtinLanguageTypescript from "@/addons/builtin.language.typescript/index";
import * as builtinLanguagePython from "@/addons/builtin.language.python/index";
import * as builtinLanguageRust from "@/addons/builtin.language.rust/index";
import * as builtinLanguageHtml from "@/addons/builtin.language.html/index";
import * as builtinLanguageMarkdown from "@/addons/builtin.language.markdown/index";
import { registerBuiltinTranslations } from "./builtin.l10n";
import { logger } from "@/lib/logger";

export interface PluginExports {
    activate?: (trixty: typeof import("@/api/trixty").trixty) => void | Promise<void>;
    deactivate?: () => void | Promise<void>;
    // Allow for additional metadata but avoid unknown if possible
    metadata?: Record<string, string | number | boolean>;
}

export interface PluginModule {
    exports: PluginExports;
}

export class PluginManager {
    static async bootstrap() {
        logger.debug("[PluginManager] Bootstrapping built-in extensions and localizations...");

        // Load translations first
        registerBuiltinTranslations();

        try {
            builtinAiAssistant.activate();
            logger.debug("[PluginManager] builtin.ai-assistant activated.");
        } catch (e) {
            console.error("Failed to activate AI assistant", e);
        }

        try {
            builtinGitExplorer.activate();
            logger.debug("[PluginManager] builtin.git-explorer activated.");
        } catch (e) {
            console.error("Failed to activate Git Explorer", e);
        }

      // Language Addons
      try {
        builtinLanguageTypescript.activate(window.trixty);
        builtinLanguagePython.activate(window.trixty);
        builtinLanguageRust.activate(window.trixty);
        builtinLanguageHtml.activate(window.trixty);
        builtinLanguageMarkdown.activate(window.trixty);

        logger.debug("[PluginManager] Built-in language addons activated.");
      } catch (e) {
        console.error("Failed to activate language addons", e);
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

        logger.debug("[PluginManager] Scanning for installed third-party extensions...");
        const installed = await invoke("get_installed_extensions");

        for (const ext_id of installed) {
            const isActive = await invoke("is_extension_active", { id: ext_id });
            if (isActive) {
                logger.debug(`[PluginManager] Loading external addon: ${ext_id}`);
                try {
                    const scriptStr = await invoke("read_extension_script", { id: ext_id });

                    // Emulate a CommonJS Module Sandbox
                    const moduleContext: PluginModule = { exports: {} };
                    // We supply React and trixty as arguments to the Function enclosure safely
                    type PluginRunner = (module: PluginModule, exports: PluginExports, React: typeof import("react"), trixty: typeof import("@/api/trixty").trixty) => void;
                    const runner = new Function('module', 'exports', 'React', 'trixty', scriptStr) as PluginRunner;

                    // Evaluate in the Webview JS Engine context
                    runner(moduleContext, moduleContext.exports, window.React, window.trixty);

                    const activate = moduleContext.exports.activate;
                    if (typeof activate === 'function') {
                        activate(window.trixty);
                        logger.debug(`[PluginManager] Addon ${ext_id} activated successfully!`);
                    } else {
                        console.warn(`[PluginManager] Addon ${ext_id} executed but exported no 'activate' function.`);
                    }
                } catch (err) {
                    console.error(`[PluginManager] Error evaluating addon ${ext_id}:`, err);
                }
            } else {
                logger.debug(`[PluginManager] Skipping ${ext_id} (Disabled)`);
            }
        }
    }
}
