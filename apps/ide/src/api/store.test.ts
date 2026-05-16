import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trixtyStore } from "./store";

// Shared in-memory backing store for the stubbed `localStorage`. Reset
// between tests so each case sees a clean slate; the singleton
// `trixtyStore` itself has no persistent state when running outside Tauri
// so no other cleanup is needed.
const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memory.set(k, v);
    },
    removeItem: (k: string) => {
      memory.delete(k);
    },
  });
  // `isTauri()` checks `window.__TAURI_INTERNALS__`. Stubbing `window` to an
  // empty object makes the check return false and forces TrixtyStore down
  // the localStorage-backed path — exactly the dev-browser behaviour we
  // want to exercise here.
  vi.stubGlobal("window", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Settings {
  theme: string;
  fontSize: number;
}

const DEFAULTS: Settings = { theme: "dark", fontSize: 14 };

describe("trixtyStore.getVersioned / setVersioned", () => {
  it("returns defaultValue when the key has never been written", async () => {
    const result = await trixtyStore.getVersioned<Settings>(
      "settings",
      1,
      DEFAULTS,
    );
    expect(result).toEqual(DEFAULTS);
    // No side-effect write: a missing key must not create an envelope.
    expect(memory.has("settings")).toBe(false);
  });

  it("wraps the value in a version envelope on setVersioned", async () => {
    await trixtyStore.setVersioned("settings", { theme: "light", fontSize: 16 }, 1);
    const raw = JSON.parse(memory.get("settings")!);
    expect(raw).toEqual({ version: 1, data: { theme: "light", fontSize: 16 } });
  });

  it("round-trips a versioned value unchanged when versions match", async () => {
    await trixtyStore.setVersioned("settings", { theme: "light", fontSize: 16 }, 1);
    const result = await trixtyStore.getVersioned<Settings>(
      "settings",
      1,
      DEFAULTS,
    );
    expect(result).toEqual({ theme: "light", fontSize: 16 });
  });

  it("treats legacy unwrapped data as version 0 and migrates it", async () => {
    // Seed the key with a raw (pre-versioning) payload, no envelope.
    memory.set("settings", JSON.stringify({ theme: "light", fontSize: 12 }));
    const migrations = {
      // v0 -> v1: bump any legacy fontSize below 14 to the new minimum.
      0: (prev: unknown): Settings => {
        const s = prev as Settings;
        return { ...s, fontSize: Math.max(s.fontSize, 14) };
      },
    };

    const result = await trixtyStore.getVersioned<Settings>(
      "settings",
      1,
      DEFAULTS,
      migrations,
    );
    expect(result).toEqual({ theme: "light", fontSize: 14 });

    // Rewrite uses the envelope shape going forward.
    const rewritten = JSON.parse(memory.get("settings")!);
    expect(rewritten.version).toBe(1);
    expect(rewritten.data).toEqual({ theme: "light", fontSize: 14 });
  });

  it("runs the migration ladder across multiple versions", async () => {
    memory.set(
      "settings",
      JSON.stringify({ version: 1, data: { theme: "light", fontSize: 14 } }),
    );
    const migrations = {
      1: (prev: unknown): Settings => ({ ...(prev as Settings), fontSize: 15 }),
      2: (prev: unknown): Settings => ({ ...(prev as Settings), theme: "system" }),
    };

    const result = await trixtyStore.getVersioned<Settings>(
      "settings",
      3,
      DEFAULTS,
      migrations,
    );
    // v1 -> v2 bumped fontSize to 15, then v2 -> v3 rewrote theme.
    expect(result).toEqual({ theme: "system", fontSize: 15 });

    const rewritten = JSON.parse(memory.get("settings")!);
    expect(rewritten.version).toBe(3);
  });

  it("tolerates gaps in the migration map (passes through unchanged)", async () => {
    // Additive schema bumps (new optional field with a default) do not
    // need a migration function. The ladder must skip cleanly.
    memory.set(
      "settings",
      JSON.stringify({ version: 1, data: { theme: "light", fontSize: 14 } }),
    );

    const result = await trixtyStore.getVersioned<Settings>(
      "settings",
      3,
      DEFAULTS,
      {}, // no migrations registered
    );
    expect(result).toEqual({ theme: "light", fontSize: 14 });
    // Envelope is still rewritten at the new version so the next read is
    // a same-version fast path.
    const rewritten = JSON.parse(memory.get("settings")!);
    expect(rewritten.version).toBe(3);
  });

  it("resets to defaults when stored version is newer (downgrade)", async () => {
    memory.set(
      "settings",
      JSON.stringify({ version: 5, data: { theme: "holographic", fontSize: 20 } }),
    );

    const result = await trixtyStore.getVersioned<Settings>(
      "settings",
      2,
      DEFAULTS,
    );
    expect(result).toEqual(DEFAULTS);

    const rewritten = JSON.parse(memory.get("settings")!);
    expect(rewritten.version).toBe(2);
    expect(rewritten.data).toEqual(DEFAULTS);
  });

  it("treats a non-object legacy payload as version 0 and migrates", async () => {
    // Some old values were stored as raw primitives (e.g. a string locale).
    // The legacy branch must accept those too.
    memory.set("locale", JSON.stringify("es"));
    const result = await trixtyStore.getVersioned<string>(
      "locale",
      1,
      "en",
      { 0: (prev) => (prev === "es" ? "es-ES" : (prev as string)) },
    );
    expect(result).toBe("es-ES");

    const rewritten = JSON.parse(memory.get("locale")!);
    expect(rewritten).toEqual({ version: 1, data: "es-ES" });
  });
});
