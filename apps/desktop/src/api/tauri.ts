import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * Checks if the application is currently running within a Tauri environment.
 * In a standard browser, this returns false.
 */
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
};

/**
 * A safe wrapper around Tauri's 'invoke' command.
 * 
 * If running in a browser environment where Tauri internals are missing, 
 * it will log a warning and return a meaningful default or reject gracefully, 
 * preventing the application from crashing.
 */
export async function safeInvoke<T>(cmd: string, args?: any): Promise<T> {
  if (isTauri()) {
    try {
      return await tauriInvoke<T>(cmd, args);
    } catch (error) {
      console.error(`[Tauri Invoke Error] ${cmd}:`, error);
      throw error;
    }
  }

  // Graceful degradation for browser development
  console.warn(`[Tauri Mock] Command ignored (not in Tauri): ${cmd}`, args);
  
  // Return empty/default values for common commands to avoid UI breakage
  if (cmd === "get_installed_extensions") return [] as unknown as T;
  if (cmd === "get_registry_catalog") return { marketplace: [] } as unknown as T;
  if (cmd === "is_extension_active") return false as unknown as T;
  
  return Promise.reject(new Error(`Tauri internals not found while calling "${cmd}". Ensure you are running in the desktop app window.`));
}
