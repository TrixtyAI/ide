import { registerBuiltinTranslations } from "./builtin.l10n";
import { logger } from "@/lib/logger";
import { trixty } from "@/api/trixty";
import {
  diffCapabilities,
  effectiveGrants,
  legacyCapabilitySet,
  loadAllGrants,
  parseManifestCapabilities,
  persistDecision,
} from "@/api/sandbox/capabilities";
import type { Capability } from "@/api/sandbox/types";
import { spawnExtensionWorker, type SandboxHandle } from "@/api/sandbox/host";
import { promptForApproval } from "@/api/sandbox/approvalPrompt";

/**
 * Bootstrap logic for built-in and third-party addons.
 *
 * History: prior to the sandbox refactor, third-party extensions were
 * evaluated with `new Function(...)` inside the main webview and were
 * handed `window.React`, `window.trixty`, and `window.LucideIcons`.
 * That meant every extension ran with the IDE process's full privilege
 * set — effectively unrestricted RCE at the process level. See issue
 * #108.
 *
 * The new flow for external extensions:
 * 1. Read the extension's `package.json` via `read_extension_manifest`.
 * 2. Parse `trixty.capabilities`; if missing, treat as legacy and
 *    request the full capability set with a warning banner.
 * 3. Diff against persisted grants (`trixtyStore[trixty-extension-grants]`).
 *    If any capability is unseen, prompt the user.
 * 4. If the user grants a non-empty set, spawn a Web Worker sandbox and
 *    hand it the script plus the approved capability list. Everything
 *    after this runs in an isolated realm.
 *
 * Built-in addons (anything under `apps/desktop/src/addons/builtin.*`)
 * continue to import `@/api/trixty` directly. They are first-party code
 * audited with the rest of the app and do not need the sandbox.
 */

// Tracks live sandboxes so we can dispose them on app teardown or when
// an extension is toggled off at runtime. Keyed by extension id.
const liveSandboxes = new Map<string, SandboxHandle>();

export class PluginManager {
    static async bootstrap() {
        logger.debug("[PluginManager] Bootstrapping built-in extensions and localizations...");

        // Load translations first
        registerBuiltinTranslations();

        // Built-in addons are imported dynamically so they become their own
        // chunks instead of riding in the initial bundle. AiChatComponent in
        // particular pulls react-markdown + remark-gfm and GitExplorer pulls
        // picomatch + git dialogs, so defer both until the user is past the
        // first paint.
        try {
            const mod = await import("@/addons/builtin.ai-assistant/index");
            mod.activate();
            logger.debug("[PluginManager] builtin.ai-assistant activated.");
        } catch (e) {
            logger.error("Failed to activate AI assistant", e);
        }

        try {
            const mod = await import("@/addons/builtin.git-explorer/index");
            mod.activate();
            logger.debug("[PluginManager] builtin.git-explorer activated.");
        } catch (e) {
            logger.error("Failed to activate Git Explorer", e);
        }

        // Language Addons — registered in parallel so one slow import doesn't
        // block the rest of the bootstrap chain.
        try {
            const [ts, py, rs, html, md] = await Promise.all([
                import("@/addons/builtin.language.typescript/index"),
                import("@/addons/builtin.language.python/index"),
                import("@/addons/builtin.language.rust/index"),
                import("@/addons/builtin.language.html/index"),
                import("@/addons/builtin.language.markdown/index"),
            ]);
            // Built-in addons get the same singleton that external
            // sandboxed extensions access indirectly through the bridge.
            // Passing it explicitly avoids the old `window.trixty`
            // global-lookup pattern, which confused TypeScript and let
            // rogue third-party code reach the registry from the main
            // thread.
            ts.activate(trixty);
            py.activate(trixty);
            rs.activate(trixty);
            html.activate(trixty);
            md.activate(trixty);

            logger.debug("[PluginManager] Built-in language addons activated.");
        } catch (e) {
            logger.error("Failed to activate language addons", e);
        }

        // Dynamically load external scripts from Tauri File System
        try {
            await this.loadExternalAddons();
        } catch (e) {
            logger.error("Failed to load external addons", e);
        }
    }

    /**
     * Teardown hook — call before app reset / full reload. Leaves the host
     * `trixty` registries in their current state (the host itself handles
     * that) but terminates every worker so we don't leak isolates.
     */
    static disposeAll() {
        for (const handle of liveSandboxes.values()) {
            try { handle.dispose(); } catch { /* best effort */ }
        }
        liveSandboxes.clear();
    }

    private static async loadExternalAddons() {
        const { safeInvoke: invoke } = await import('@/api/tauri');

        logger.debug("[PluginManager] Scanning for installed third-party extensions...");
        const installed = await invoke("get_installed_extensions");

        // Load the persisted grants map once up front so each extension's
        // decision write merges into the same snapshot instead of racing
        // other extensions started in parallel.
        let allGrants = await loadAllGrants();

        for (const ext_id of installed) {
            const isActive = await invoke("is_extension_active", { id: ext_id });
            if (!isActive) {
                logger.debug(`[PluginManager] Skipping ${ext_id} (Disabled)`);
                continue;
            }

            try {
                // Read manifest + script before deciding what to do — if
                // either read fails, we log and skip rather than killing
                // the whole bootstrap chain.
                const [script, manifestText] = await Promise.all([
                    invoke("read_extension_script", { id: ext_id }),
                    invoke("read_extension_manifest", { id: ext_id }).catch(() => "{}"),
                ]);

                const { capabilities, unknown, legacy } = parseManifestCapabilities(manifestText);
                if (unknown.length > 0) {
                    logger.warn(
                        `[PluginManager] Extension ${ext_id} requests unknown capabilities: ${unknown.join(", ")}`,
                    );
                }

                // Legacy manifests trigger the "everything" request so the
                // user has a single decision point. A modern manifest can
                // still request an empty set — in that case we skip the
                // modal entirely because there's nothing to grant.
                const requested: Capability[] = legacy ? legacyCapabilitySet() : capabilities;

                const diff = diffCapabilities(requested, allGrants[ext_id]);

                const needsPrompt = diff.pendingApproval.length > 0;
                let granted: Capability[] = effectiveGrants(allGrants, ext_id).filter((c) =>
                    requested.includes(c),
                );

                if (needsPrompt) {
                    const displayName = await this.resolveDisplayName(manifestText, ext_id);
                    const decision = await promptForApproval({
                        extensionId: ext_id,
                        displayName,
                        requested,
                        alreadyGranted: diff.alreadyGranted,
                        alreadyDenied: diff.alreadyDenied,
                        legacy,
                    });

                    if (decision.cancelled) {
                        logger.debug(`[PluginManager] Approval cancelled for ${ext_id}; skipping load`);
                        continue;
                    }

                    allGrants = await persistDecision({
                        extensionId: ext_id,
                        requested,
                        approved: decision.approved,
                        denied: decision.denied,
                        existingGrants: allGrants,
                    });
                    granted = decision.approved;
                }

                if (granted.length === 0 && requested.length > 0) {
                    logger.debug(`[PluginManager] ${ext_id} has no granted capabilities; not spawning worker`);
                    continue;
                }

                logger.debug(`[PluginManager] Spawning sandbox for ${ext_id} with ${granted.length} capabilities`);
                const handle = spawnExtensionWorker({
                    extensionId: ext_id,
                    script,
                    grantedCapabilities: granted,
                });
                liveSandboxes.set(ext_id, handle);

                // Await readiness but don't let a single broken extension
                // block the bootstrap chain.
                handle.ready.catch((e) => {
                    logger.error(`[PluginManager] Extension ${ext_id} failed to activate:`, e);
                });
            } catch (err) {
                logger.error(`[PluginManager] Error loading addon ${ext_id}:`, err);
            }
        }
    }

    /**
     * Best-effort pretty-name lookup for the approval modal. Falls back to
     * the raw id — never throws.
     */
    private static async resolveDisplayName(manifestText: string, id: string): Promise<string> {
        try {
            const parsed = JSON.parse(manifestText) as Record<string, unknown>;
            const display =
                (typeof parsed.displayName === "string" && parsed.displayName) ||
                (typeof parsed.name === "string" && parsed.name) ||
                id;
            return display;
        } catch {
            return id;
        }
    }
}
