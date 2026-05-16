import { afterEach, describe, expect, it, vi } from "vitest";
import { floatingWindowRegistry } from "./floatingWindowRegistry";

afterEach(() => {
  floatingWindowRegistry.__resetForTests();
});

describe("floatingWindowRegistry", () => {
  it("starts empty", () => {
    expect(floatingWindowRegistry.list()).toEqual([]);
    expect(floatingWindowRegistry.isDetached("any")).toBe(false);
    expect(floatingWindowRegistry.getEntry("any")).toBeUndefined();
  });

  it("detach() adds the view with a Tauri-safe windowLabel (dots sanitized)", async () => {
    await floatingWindowRegistry.detach("trixty.builtin.ai-assistant", "right");
    expect(floatingWindowRegistry.isDetached("trixty.builtin.ai-assistant")).toBe(true);
    // Tauri 2 only allows a-zA-Z0-9-/:_ in window labels; dots in the viewId
    // must be replaced or the WebviewWindow constructor rejects on the Rust
    // side and the slot is stranded on the placeholder.
    const entry = floatingWindowRegistry.getEntry("trixty.builtin.ai-assistant");
    // Sanitized prefix + 4-char FNV hash suffix to disambiguate viewIds
    // that collapse to the same sanitized form (e.g. `a.b` vs `a:b`).
    expect(entry?.windowLabel).toMatch(
      /^floating-trixty_builtin_ai-assistant-[0-9a-f]{4}$/,
    );
    expect(entry?.panel).toBe("right");
  });

  it("buildWindowLabel disambiguates viewIds that share a sanitized prefix", async () => {
    // Both `.` and ` ` are outside the Tauri label charset and both
    // collapse to `_` under sanitization, so without the hash suffix
    // these two distinct viewIds would share a window label.
    await floatingWindowRegistry.detach("a.b", "right");
    await floatingWindowRegistry.detach("a b", "right");
    const aDot = floatingWindowRegistry.getEntry("a.b");
    const aSpace = floatingWindowRegistry.getEntry("a b");
    expect(aDot?.windowLabel).not.toBe(aSpace?.windowLabel);
  });

  it("detach() is idempotent — second call does not duplicate listener notifications", async () => {
    const listener = vi.fn();
    floatingWindowRegistry.subscribe(listener);
    await floatingWindowRegistry.detach("v1", "right");
    await floatingWindowRegistry.detach("v1", "right");
    expect(floatingWindowRegistry.list()).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("redock() removes the view", async () => {
    await floatingWindowRegistry.detach("v1", "right");
    await floatingWindowRegistry.redock("v1");
    expect(floatingWindowRegistry.isDetached("v1")).toBe(false);
    expect(floatingWindowRegistry.list()).toEqual([]);
  });

  it("redock() on an unknown view is a no-op and does not notify", async () => {
    const listener = vi.fn();
    floatingWindowRegistry.subscribe(listener);
    await floatingWindowRegistry.redock("never-detached");
    expect(listener).not.toHaveBeenCalled();
  });

  it("subscribe() fires on detach and redock; unsubscribe stops further notifications", async () => {
    const listener = vi.fn();
    const unsubscribe = floatingWindowRegistry.subscribe(listener);
    await floatingWindowRegistry.detach("v1", "right");
    expect(listener).toHaveBeenCalledTimes(1);
    await floatingWindowRegistry.redock("v1");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    await floatingWindowRegistry.detach("v2", "right");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("subscribe stays bound when destructured (useSyncExternalStore safe)", () => {
    const { subscribe } = floatingWindowRegistry;
    const listener = vi.fn();
    expect(() => {
      const unsubscribe = subscribe(listener);
      unsubscribe();
    }).not.toThrow();
  });

  it("supports multiple simultaneous detachments", async () => {
    await floatingWindowRegistry.detach("a", "right");
    await floatingWindowRegistry.detach("b", "right");
    await floatingWindowRegistry.detach("c", "right");
    expect(floatingWindowRegistry.list().map((e) => e.viewId).sort()).toEqual(["a", "b", "c"]);
  });
});
