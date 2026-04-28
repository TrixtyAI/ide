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

  it("detach() adds the view with a deterministic windowLabel", async () => {
    await floatingWindowRegistry.detach("trixty.builtin.ai-assistant", "right");
    expect(floatingWindowRegistry.isDetached("trixty.builtin.ai-assistant")).toBe(true);
    expect(floatingWindowRegistry.getEntry("trixty.builtin.ai-assistant")).toEqual({
      windowLabel: "floating-trixty.builtin.ai-assistant",
      panel: "right",
    });
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

  it("supports multiple simultaneous detachments", async () => {
    await floatingWindowRegistry.detach("a", "right");
    await floatingWindowRegistry.detach("b", "right");
    await floatingWindowRegistry.detach("c", "right");
    expect(floatingWindowRegistry.list().map((e) => e.viewId).sort()).toEqual(["a", "b", "c"]);
  });
});
