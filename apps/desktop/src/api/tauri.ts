import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { type MarketplaceEntry, type ExtensionManifest } from "@/context/ExtensionContext";
import { logger } from "@/lib/logger";

export interface SearchResult {
  file_path: string;
  file_name: string;
  line_number: number;
  content: string;
}

export interface GitLogEntry {
  hash: string;
  short_hash: string;
  author: string;
  email: string;
  timestamp: number;
  subject: string;
}

export interface GitStashEntry {
  index: number;
  ref_name: string;
  message: string;
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: DirEntry[];
}

export type OllamaRequest = Record<string, unknown>;

/**
 * Central registry of Tauri commands exposed to the frontend.
 *
 * Naming convention at the TS ↔ Rust boundary:
 * - Rust command handlers are defined in `snake_case` (e.g. `install_extension`, `git_url`, `root_path`).
 * - Their TypeScript entries here use `camelCase` for argument names (e.g. `gitUrl`, `rootPath`).
 * - Tauri performs the `camelCase` ↔ `snake_case` conversion automatically on both sides.
 *
 * When adding a new command:
 * 1. Define the Rust `#[tauri::command]` using `snake_case` parameters.
 * 2. Register it in the `run()` builder via `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`.
 * 3. Add an entry here with `camelCase` argument names matching the Rust parameters.
 *
 * Tauri-injected parameters such as `AppHandle`, `State<T>` or `Window` are NOT part of the
 * frontend call signature — they are resolved by the Tauri runtime and must be omitted from
 * the TypeScript entry.
 *
 * Example: a Rust handler
 * `async fn install_extension(app: AppHandle, id: String, git_url: String) -> Result<(), String>`
 * maps to `"install_extension": { args: { id: string; gitUrl: string }; return: void }`.
 */
export interface TauriInvokeMap {
  "get_installed_extensions": { args: undefined; return: string[] };
  "get_registry_catalog": { args: { url: string }; return: { marketplace: MarketplaceEntry[] } };
  "is_extension_active": { args: { id: string }; return: boolean };
  "install_extension": { args: { id: string; gitUrl: string }; return: void };
  "uninstall_extension": { args: { id: string }; return: void };
  "update_extension": { args: { id: string }; return: void };
  "toggle_extension_state": { args: { id: string; isActive: boolean }; return: void };
  "fetch_extension_manifest": { args: { repoUrl: string; branch: string; dataUrl?: string; path?: string }; return: ExtensionManifest };
  "fetch_extension_file": { args: { repoUrl: string; branch: string; path?: string; fileName: string }; return: string };
  "fetch_extension_stars": { args: { repoUrl: string }; return: number | null };
  "read_file": { args: { path: string }; return: string };
  "write_file": { args: { path: string; content: string }; return: void };
  "read_directory": { args: { path: string }; return: DirEntry[] };
  "delete_path": { args: { path: string }; return: void };
  "create_directory": { args: { path: string }; return: void };
  "reveal_path": { args: { path: string }; return: void };
  "execute_command": { args: { command: string; args: string[]; cwd?: string | null }; return: string };
  "get_recursive_file_list": { args: { rootPath: string | null }; return: string[] };
  "get_system_health": { args: undefined; return: { cpu_usage: number; memory_usage: number } };
  "ollama_proxy": { args: { method: string; url: string; headers?: Record<string, string>; body?: OllamaRequest }; return: { status: number; body: string } };
  "ollama_proxy_stream": { args: { streamId: string; method: string; url: string; headers?: Record<string, string>; body: OllamaRequest; rawMode?: boolean }; return: void };
  "ollama_proxy_cancel": { args: { streamId: string }; return: void };
  "check_update": { args: undefined; return: { version: string; body?: string | null } | null };
  "install_update": { args: undefined; return: void };
  "spawn_pty": { args: { sessionId: string; cwd?: string; rows?: number; cols?: number }; return: void };
  "write_to_pty": { args: { sessionId: string; data: string }; return: void };
  "resize_pty": { args: { sessionId: string; rows: number; cols: number }; return: void };
  "kill_pty": { args: { sessionId: string }; return: void };
  "git_add": { args: { path: string; files: string[] }; return: void };
  "git_unstage": { args: { path: string; files: string[] }; return: void };
  "git_add_safe_directory": { args: { path: string }; return: void };
  "get_git_status": { args: { path: string }; return: string };
  "get_git_branches": { args: { path: string }; return: { branches: string[]; current: string } };
  "git_checkout_branch": { args: { path: string; branch: string }; return: string };
  "git_create_branch": { args: { path: string; branch: string }; return: string };
  "git_pull": { args: { path: string; rebase?: boolean }; return: string };
  "git_fetch": { args: { path: string }; return: string };
  "git_log": { args: { path: string; limit?: number }; return: GitLogEntry[] };
  "git_merge": { args: { path: string; branch: string }; return: string };
  "git_reset": { args: { path: string; mode: "soft" | "mixed" | "hard"; target: string }; return: string };
  "git_revert": { args: { path: string; commit: string }; return: string };
  "git_stash": { args: { path: string; message?: string }; return: string };
  "git_stash_pop": { args: { path: string; index?: number }; return: string };
  "git_stash_apply": { args: { path: string; index: number }; return: string };
  "git_stash_drop": { args: { path: string; index: number }; return: string };
  "git_stash_list": { args: { path: string }; return: GitStashEntry[] };
  "git_restore": { args: { path: string; files: string[] }; return: string };
  "get_git_file_diff": { args: { path: string; file: string; staged: boolean }; return: string };
  "get_git_diff": { args: { path: string }; return: string };
  "git_init": { args: { path: string }; return: string };
  "git_commit": { args: { path: string; message: string; amend?: boolean }; return: string };
  "git_push": { args: { path: string }; return: string };
  "search_in_project": { args: { query: string; rootPath: string; filesExclude?: string[] }; return: SearchResult[] };
  "read_extension_script": { args: { id: string }; return: string };
  "read_extension_manifest": { args: { id: string }; return: string };
  "perform_web_search": { args: { query: string }; return: string };
  "watch_path": { args: { path: string; excludes: string[] }; return: void };
  "unwatch_all": { args: undefined; return: void };
  "set_workspace_root": { args: { path: string | null }; return: void };
  "get_cloud_config": { args: undefined; return: string };
  "take_initial_cli_workspace": { args: undefined; return: string | null };
  "get_trixty_about_info": { args: undefined; return: Record<string, string> };
}

/**
 * Payload emitted on the `fs-changed` Tauri event. Subscribe with
 * `listen<FsChangeEvent>("fs-changed", ...)` after calling `watch_path`.
 */
export interface FsChangeEvent {
  path: string;
  kind: "created" | "modified" | "removed" | "renamed" | "other";
}

/**
 * Payload emitted on the `pty-output` Tauri event. Multiple terminal tabs
 * share this single event channel, so every consumer MUST filter on
 * `sessionId` before writing to its xterm — otherwise output from tab A
 * would appear in tab B.
 */
export interface PtyOutputEvent {
  sessionId: string;
  data: string;
}

/**
 * Checks if the application is currently running within a Tauri environment.
 * In a standard browser, this returns false.
 */
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
};

/**
 * A safe wrapper around Tauri's 'invoke' command.
 *
 * If running in a browser environment where Tauri internals are missing,
 * it will log a warning and return a meaningful default or reject gracefully,
 * preventing the application from crashing.
 */
export async function safeInvoke<K extends keyof TauriInvokeMap>(
  cmd: K,
  args?: TauriInvokeMap[K]["args"],
  options: { silent?: boolean } = {}
): Promise<TauriInvokeMap[K]["return"]> {
  const payload = args as Record<string, unknown> | undefined;
  if (isTauri()) {
    try {
      return await tauriInvoke<TauriInvokeMap[K]["return"]>(cmd, payload);
    } catch (error) {
      if (!options.silent) {
        logger.error(`[Tauri Invoke Error] ${cmd}:`, error);
      }
      throw error;
    }
  }

  // Graceful degradation for browser development
  logger.warn(`[Tauri Mock] Command ignored (not in Tauri): ${cmd}`, payload);

  // Return empty/default values for common commands so `next dev` in the
  // browser doesn't crash on boot-time queries. Only applied in development:
  // in a production build, Tauri should always be present, so falling back
  // to a silent default would mask a real initialization failure instead of
  // surfacing it. When NODE_ENV is "production" we reject with a clear error
  // and let the caller deal with it.
  const isDev = process.env.NODE_ENV !== "production";
  const defaults: Partial<{ [K in keyof TauriInvokeMap]: TauriInvokeMap[K]["return"] }> = {
    "get_installed_extensions": [],
    "get_registry_catalog": { marketplace: [] },
    "is_extension_active": false,
    "get_system_health": { cpu_usage: 0, memory_usage: 0 }
  };

  if (isDev && cmd in defaults) {
      return defaults[cmd as keyof typeof defaults] as TauriInvokeMap[K]["return"];
  }

  return Promise.reject(new Error(`Tauri internals not found while calling "${cmd}". Ensure you are running in the desktop app window.`));
}
