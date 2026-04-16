import { load, Store } from "@tauri-apps/plugin-store";

/**
 * Global Store instance managed by tauri-plugin-store.
 * File is saved as "settings.json" in the app data directory.
 */
const STORE_NAME = "settings.json";

class TrixtyStore {
  private store: Store | null = null;
  private initPromise: Promise<void> | null = null;

  async init() {
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = (async () => {
      console.log(`[Store] Initializing ${STORE_NAME}...`);
      try {
        // Load (or create) the store file
        this.store = await load(STORE_NAME, { autoSave: true, defaults: {} });
        console.log(`[Store] ${STORE_NAME} loaded successfully.`);
        
        // Migration from localStorage
        await this.migrateFromLocalStorage();
      } catch (e) {
        console.error(`[Store] Failed to initialize store:`, e);
        this.initPromise = null; // Allow retry on failure
        throw e;
      }
    })();

    return this.initPromise;
  }

  private async migrateFromLocalStorage() {
    if (typeof window === "undefined" || !this.store) return;

    const migrationKeys = [
      "trixty-chats",
      "trixty-ai-settings",
      "trixty-locale",
      "trixty-editor-settings",
      "trixty-system-settings",
      "trixty_ai_last_model"
    ];

    let migratedSomething = false;

    for (const key of migrationKeys) {
      const localValue = localStorage.getItem(key);
      if (localValue !== null) {
        // Check if store already has this key to avoid overwriting newer data if migration already happened
        const existingValue = await this.store.get(key);
        if (existingValue === undefined) {
          console.log(`[Store] Migrating ${key} from localStorage...`);
          try {
            // Try to parse if it looks like JSON, otherwise store as string
            const parsed = this.safeParse(localValue);
            await this.store.set(key, parsed);
            migratedSomething = true;
          } catch (e) {
            console.error(`[Store] Failed to migrate ${key}:`, e);
          }
        }
      }
    }

    if (migratedSomething) {
      await this.store!.save();
      console.log("[Store] Migration complete. You may manually clear localStorage.");
      // Optional: localStorage.clear() - keeping it for now for safety during early adoption
    }
  }

  private safeParse(value: string) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  async get<T>(key: string, defaultValue: T): Promise<T> {
    await this.init();
    const val = await this.store!.get(key);
    return (val as T) ?? defaultValue;
  }

  async set(key: string, value: unknown) {
    await this.init();
    await this.store!.set(key, value);
    await this.store!.save();
  }

  async delete(key: string) {
    await this.init();
    await this.store!.delete(key);
    await this.store!.save();
  }
}

export const trixtyStore = new TrixtyStore();
