import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HostMessage,
  WorkerMessage,
} from "./types";

// These tests exercise the host-side capability dispatcher without
// actually spawning a Web Worker. We do that by stubbing `Worker`
// globally BEFORE importing `spawnExtensionWorker`, so the module's
// `new Worker(...)` call lands on our fake instead of the real
// constructor (which would throw outside a DOM).

// -- fake Worker ------------------------------------------------------------

class FakeWorker {
  static last: FakeWorker | null = null;
  private listeners = new Map<string, Set<(event: unknown) => void>>();
  postMessages: HostMessage[] = [];
  terminated = false;

  constructor(public url: string | URL, public options?: WorkerOptions) {
    FakeWorker.last = this;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(data: HostMessage): void {
    this.postMessages.push(data);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Drive an incoming message from the "worker" side of the bridge. */
  emitMessage(data: WorkerMessage): void {
    const set = this.listeners.get("message");
    if (!set) return;
    for (const fn of set) fn({ data });
  }
}

// Stub required host-adjacent modules.
const memory = new Map<string, string>();

beforeEach(async () => {
  memory.clear();
  FakeWorker.last = null;

  vi.stubGlobal("localStorage", {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memory.set(k, v);
    },
    removeItem: (k: string) => {
      memory.delete(k);
    },
  });
  vi.stubGlobal("window", {});
  vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob://stub",
    revokeObjectURL: () => {},
  });
  vi.stubGlobal("Blob", function Blob(this: unknown) {
    /* noop */
  });
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => undefined) } });
  // `import.meta.url` is honoured by the real Worker constructor; the
  // fake just stashes whatever URL-ish object was passed in.

  // Reset module registry so the trixty singleton under test is fresh.
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("spawnExtensionWorker — bridge behaviour", () => {
  it("sends a host:init message with the granted capability set", async () => {
    const { spawnExtensionWorker } = await import("./host");
    spawnExtensionWorker({
      extensionId: "ext.test",
      script: "// noop",
      grantedCapabilities: ["ui:show-message"],
    });

    const worker = FakeWorker.last!;
    expect(worker).toBeTruthy();
    const init = worker.postMessages.find((m) => m.kind === "host:init");
    expect(init).toBeTruthy();
    if (init && init.kind === "host:init") {
      expect(init.extensionId).toBe("ext.test");
      expect(init.grantedCapabilities).toEqual(["ui:show-message"]);
    }
  });

  it("rejects requests for capabilities that were not granted", async () => {
    const { spawnExtensionWorker } = await import("./host");
    spawnExtensionWorker({
      extensionId: "ext.denied",
      script: "",
      grantedCapabilities: [],
    });
    const worker = FakeWorker.last!;
    worker.postMessages.length = 0; // clear init

    worker.emitMessage({
      kind: "worker:request",
      id: 7,
      capability: "fs:read",
      method: "readFile",
      args: { path: "secret.txt" },
    });

    // Allow the async dispatcher to run a microtask cycle.
    await Promise.resolve();
    await Promise.resolve();

    const err = worker.postMessages.find(
      (m) => m.kind === "host:error" && (m as { id?: number }).id === 7,
    );
    expect(err).toBeTruthy();
    if (err && err.kind === "host:error") {
      expect(err.error.name).toBe("CapabilityDeniedError");
      expect(err.error.message).toMatch(/fs:read/);
    }
  });

  it("drops malformed worker messages without crashing the dispatcher", async () => {
    const { spawnExtensionWorker } = await import("./host");
    spawnExtensionWorker({
      extensionId: "ext.malformed",
      script: "",
      grantedCapabilities: [],
    });
    const worker = FakeWorker.last!;

    // Direct emit of something that doesn't match the WorkerMessage
    // shape. Cast through `unknown` because the test is explicitly
    // bypassing the type system.
    expect(() =>
      (worker as unknown as { emitMessage: (m: unknown) => void }).emitMessage(
        { notAMessage: true } as unknown,
      ),
    ).not.toThrow();

    expect(() =>
      (worker as unknown as { emitMessage: (m: unknown) => void }).emitMessage(null),
    ).not.toThrow();
  });

  it("rejects the `ready` promise when the worker reports activate failure", async () => {
    const { spawnExtensionWorker } = await import("./host");
    const handle = spawnExtensionWorker({
      extensionId: "ext.failing",
      script: "",
      grantedCapabilities: [],
    });
    const worker = FakeWorker.last!;

    worker.emitMessage({
      kind: "worker:ready",
      ok: false,
      error: { name: "Error", message: "activate threw" },
    });

    await expect(handle.ready).rejects.toThrow(/activate threw/);
  });

  it("dispose() terminates the worker exactly once", async () => {
    const { spawnExtensionWorker } = await import("./host");
    const handle = spawnExtensionWorker({
      extensionId: "ext.dispose",
      script: "",
      grantedCapabilities: [],
    });
    const worker = FakeWorker.last!;
    handle.dispose();
    handle.dispose(); // no throw on re-dispose
    expect(worker.terminated).toBe(true);
  });

  it("rejects a worker:register-view without the ui:register-view capability", async () => {
    const { spawnExtensionWorker } = await import("./host");
    spawnExtensionWorker({
      extensionId: "ext.noview",
      script: "",
      grantedCapabilities: ["ui:show-message"],
    });
    const worker = FakeWorker.last!;
    worker.postMessages.length = 0;

    worker.emitMessage({
      kind: "worker:register-view",
      id: 1,
      viewId: "v1",
      panel: "right",
      title: "Hello",
      schema: { tag: "div", children: "hi" },
    });

    await Promise.resolve();
    const err = worker.postMessages.find(
      (m) => m.kind === "host:error" && (m as { id?: number }).id === 1,
    );
    expect(err).toBeTruthy();
    if (err && err.kind === "host:error") {
      expect(err.error.name).toBe("CapabilityDeniedError");
    }
  });
});
