import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { type MarketplaceEntry, type ExtensionManifest } from "@/context/ExtensionContext";

export interface SearchResult {
  file_path: string;
  file_name: string;
  line_number: number;
  content: string;
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: DirEntry[];
}

export type OllamaRequest =
  | { type: 'chat'; model: string; messages: unknown[]; stream?: boolean; tools?: unknown[]; options?: Record<string, unknown>; think?: boolean }
  | { type: 'generate'; model: string; prompt?: string; stream?: boolean; options?: Record<string, unknown>; keep_alive?: number }
  | { type: 'tags' }
  | { type: 'version' };

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
  "read_file": { args: { path: string }; return: string };
  "write_file": { args: { path: string; content: string }; return: void };
  "read_directory": { args: { path: string }; return: DirEntry[] };
  "delete_path": { args: { path: string }; return: void };
  "create_directory": { args: { path: string }; return: void };
  "reveal_path": { args: { path: string }; return: void };
  "execute_command": { args: { command: string; args: string[]; cwd?: string | null }; return: string };
  "get_recursive_file_list": { args: { rootPath: string | null }; return: string[] };
  "get_system_health": { args: undefined; return: { cpu_usage: number; memory_usage: number } };
  "ollama_proxy": { args: { method: string; url: string; body: OllamaRequest }; return: { status: number; body: string } };
  "check_update": { args: { url: string }; return: { version: string; body?: string | null } | null };
  "install_update": { args: { url: string }; return: void };
  "spawn_pty": { args: { cwd?: string }; return: void };
  "write_to_pty": { args: { data: string }; return: void };
  "resize_pty": { args: { rows: number; cols: number }; return: void };
  "kill_pty": { args: undefined; return: void };
  "stop_tunnel": { args: { port: number }; return: void };
  "start_tunnel": { args: { port: number }; return: string };
  "get_active_ports": { args: undefined; return: number[] };
  "git_add": { args: { path: string; files: string[] }; return: void };
  "git_unstage": { args: { path: string; files: string[] }; return: void };
  "git_add_safe_directory": { args: { path: string }; return: void };
  "get_git_status": { args: { path: string }; return: string };
  "get_git_branches": { args: { path: string }; return: string[] };
  "get_git_diff": { args: { path: string }; return: string };
  "git_init": { args: { path: string }; return: string };
  "git_commit": { args: { path: string; message: string }; return: string };
  "git_push": { args: { path: string }; return: string };
  "search_in_project": { args: { query: string; rootPath: string }; return: SearchResult[] };
  "read_extension_script": { args: { id: string }; return: string };
  "perform_web_search": { args: { query: string }; return: string };
  "get_trixty_about_info": { args: undefined; return: Record<string, string> };
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
        console.error(`[Tauri Invoke Error] ${cmd}:`, error);
      }
      throw error;
    }
  }

  // Graceful degradation for browser development
  console.warn(`[Tauri Mock] Command ignored (not in Tauri): ${cmd}`, payload);
  
  // Return empty/default values for common commands to avoid UI breakage
  const defaults: Partial<{ [K in keyof TauriInvokeMap]: TauriInvokeMap[K]["return"] }> = {
    "get_installed_extensions": [],
    "get_registry_catalog": { marketplace: [] },
    "is_extension_active": false,
    "get_system_health": { cpu_usage: 0, memory_usage: 0 }
  };

  if (cmd in defaults) {
      return defaults[cmd as keyof typeof defaults] as TauriInvokeMap[K]["return"];
  }
  
  return Promise.reject(new Error(`Tauri internals not found while calling "${cmd}". Ensure you are running in the desktop app window.`));
}
