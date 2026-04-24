/**
 * Guest bootstrap script — runs *inside* the Web Worker.
 *
 * When the worker spawns, this file builds a narrow `ctx` object that
 * mirrors (a sanitised subset of) the host's `trixty` API. Every method is
 * async and goes through `postMessage` → host dispatcher → host-side
 * `trixty.*` call → `postMessage` back. No direct reference to the host
 * `trixty` singleton ever reaches the worker realm.
 *
 * ## Isolation guarantees (from the worker's side)
 *
 * - Workers have no `window`, no `document`, no `React`, no `LucideIcons`.
 * - `@tauri-apps/*` modules cannot be imported because the worker has no
 *   way to reach the Tauri internals bridge that lives on the main
 *   thread's `window.__TAURI_INTERNALS__`.
 * - The extension's `index.js` is evaluated with `new Function(...)` *here*
 *   in the worker — still dynamic code, but now the blast radius is
 *   limited to the worker realm.
 * - Global scope is pruned before the extension runs (dangerous globals
 *   like `fetch`, `importScripts`, `XMLHttpRequest` are overwritten with
 *   throwing stubs so a hostile extension can't exfiltrate data to the
 *   network except through host-mediated capabilities).
 *
 * ## UI broker
 *
 * The worker cannot render React. When an extension calls
 * `ctx.window.registerRightPanelView({ render })`, the sandbox turns the
 * `render` function into a stateful shim:
 *
 * 1. Tracking state for the worker: a `view` object with its current UI
 *    schema, pending handler table, and last-seen props.
 * 2. First invocation: synchronously runs `render()` in a hook-less
 *    environment (we expose `ctx.ui.useState`, `ctx.ui.useEffect`
 *    equivalents that emulate hooks via a per-view state map).
 * 3. Captures the returned UI schema, assigns handler IDs, and posts
 *    `worker:register-view` to the host with the schema.
 * 4. When a handler fires on the host, it sends `host:ui-event`, the
 *    worker looks the id up, calls the registered callback, then
 *    re-renders the view and posts `worker:update-view`.
 *
 * This is deliberately simpler than React: no reconciliation, no
 * fine-grained memoisation. Extension panels are expected to be small
 * enough that re-rendering the whole schema on every event is fine.
 */

import type {
  Capability,
  HostMessage,
  WorkerMessage,
} from "./types";
import { isKnownCapability } from "./types";
import type { UiNode, UiProps } from "./uiSchema";

// `self` in a DedicatedWorker is typed as WorkerGlobalScope; keeping a
// loose local declaration avoids pulling lib.webworker into the
// project's tsconfig just for this file. We only use the `postMessage`,
// `addEventListener`, and `queueMicrotask` members, all of which are
// already typed as plain globals in the default lib.
interface WorkerGlobalLike {
  postMessage(message: unknown): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
}
declare const self: WorkerGlobalLike;

type Resolver = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

interface ViewState {
  id: string;
  panel: "left" | "right";
  title: string;
  icon?: { kind: "lucide"; name: string; size?: number; className?: string };
  render: (ctx: GuestCtx) => UiNode;
  /** Per-view hook state slots, indexed by call order. */
  hooks: unknown[];
  hookCursor: number;
  /** Map of handler id → guest callback. Rebuilt on every render. */
  handlers: Map<string, (...args: unknown[]) => void>;
  /** Counter for allocating handler ids per view. */
  handlerSeq: number;
}

export interface GuestCtx {
  commands: {
    registerCommand(id: string, callback: (...args: unknown[]) => unknown): Promise<void>;
    executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
  };
  window: {
    registerRightPanelView(view: GuestView): Promise<void>;
    registerLeftPanelView(view: GuestView): Promise<void>;
    showInformationMessage(message: string): Promise<void>;
  };
  l10n: {
    registerTranslations(locale: string, bundle: Record<string, string>): Promise<void>;
    t(key: string, params?: Record<string, string>): string;
    getLocale(): string;
    subscribe(listener: () => void): () => void;
  };
  languages: {
    register(language: Record<string, unknown>): Promise<void>;
    setMonarchTokens(id: string, rules: Record<string, unknown>): Promise<void>;
    setConfiguration(id: string, config: Record<string, unknown>): Promise<void>;
    setIndentation(id: string, options: { tabSize: number; insertSpaces: boolean }): Promise<void>;
  };
  storage: {
    get<T = unknown>(key: string, defaultValue?: T): Promise<T>;
    set(key: string, value: unknown): Promise<void>;
  };
  clipboard: {
    writeText(text: string): Promise<void>;
  };
  workspace: {
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    search(query: string): Promise<unknown>;
    info(): Promise<unknown>;
  };
  ui: {
    useState<T>(initial: T): [T, (next: T) => void];
    useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  };
}

export interface GuestView {
  id: string;
  title: string;
  icon?: { name: string; size?: number; className?: string };
  render(): UiNode;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let requestSeq = 0;
const pending = new Map<number, Resolver>();
const views = new Map<string, ViewState>();

// l10n bundles live in the worker so `t()` is synchronous (matching the
// legacy API). They're filled either by explicit `registerTranslations`
// calls from the extension, or mirrored from the host via a one-shot
// bootstrap message.
const l10nBundles = new Map<string, Record<string, string>>();
let currentLocale = "en";
const localeListeners = new Set<() => void>();

let grantedCapabilities: Set<Capability> = new Set();
let extensionId = "";

// Track the view currently being rendered so `useState` / `useEffect`
// know which view's hook slots to read/write.
let renderingView: ViewState | null = null;

// Effect scheduling is deferred until *after* the current render commit,
// matching React's semantics closely enough that simple components using
// `useState` + `useEffect` work without surprises.
const effectQueue: Array<() => void> = [];

// ---------------------------------------------------------------------------
// Host communication helpers
// ---------------------------------------------------------------------------

function postToHost(message: WorkerMessage): void {
  self.postMessage(message);
}

function request(capability: Capability, method: string, args: unknown): Promise<unknown> {
  if (!grantedCapabilities.has(capability)) {
    // Fail synchronously (via rejected promise) to keep the host wire
    // quiet — no need to burn a round-trip asking for something we know
    // the host will refuse.
    return Promise.reject(
      new Error(`Capability '${capability}' was not granted for this extension`),
    );
  }
  const id = ++requestSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    postToHost({
      kind: "worker:request",
      id,
      capability,
      method,
      args,
    });
  });
}

function safeLog(level: "debug" | "warn" | "error", args: unknown[]): void {
  try {
    postToHost({ kind: "worker:log", level, args });
  } catch {
    // Logging MUST NOT throw — losing a log line is better than killing
    // the worker.
  }
}

// ---------------------------------------------------------------------------
// UI schema helpers
// ---------------------------------------------------------------------------

function walkAndAssignHandlers(
  node: UiNode,
  view: ViewState,
): UiNode {
  const props: UiProps | undefined = node.props ? { ...node.props } : undefined;
  if (props) {
    for (const key of ["onClick", "onChange", "onInput"] as const) {
      const handler = (props as Record<string, unknown>)[key];
      if (typeof handler === "function") {
        const handlerId = `${view.id}:${++view.handlerSeq}`;
        view.handlers.set(handlerId, handler as (...args: unknown[]) => void);
        (props as Record<string, unknown>)[key] = handlerId;
      } else if (typeof handler !== "string") {
        // Anything else — drop silently so React doesn't see `undefined`
        // as a prop and warn.
        delete (props as Record<string, unknown>)[key];
      }
    }
  }

  let children: UiNode["children"];
  if (Array.isArray(node.children)) {
    children = node.children.map((child) => {
      if (typeof child === "string" || typeof child === "number") return child;
      return walkAndAssignHandlers(child, view);
    });
  } else if (typeof node.children === "string" || typeof node.children === "number") {
    children = node.children;
  }

  return { tag: node.tag, key: node.key, props, children };
}

function renderView(view: ViewState, options: { isInitial: boolean }): void {
  view.hookCursor = 0;
  view.handlers = new Map();
  view.handlerSeq = 0;

  let schema: UiNode;
  renderingView = view;
  try {
    schema = view.render({} as GuestCtx); // ctx isn't used by the render fn itself
  } catch (e) {
    safeLog("error", [`[view:${view.id}] render threw`, String((e as Error)?.message ?? e)]);
    schema = { tag: "div", children: "Extension render failed" };
  } finally {
    renderingView = null;
  }

  const prepared = walkAndAssignHandlers(schema, view);

  if (options.isInitial) {
    postToHost({
      kind: "worker:register-view",
      id: ++requestSeq,
      viewId: view.id,
      panel: view.panel,
      title: view.title,
      icon: view.icon,
      schema: prepared,
    });
  } else {
    postToHost({
      kind: "worker:update-view",
      viewId: view.id,
      schema: prepared,
    });
  }

  // Flush effects *after* the schema is posted. The effects may call
  // `setState` which will enqueue another render — that's fine, we'll
  // loop again on the next tick of the message queue.
  const effects = effectQueue.splice(0, effectQueue.length);
  for (const eff of effects) {
    try {
      eff();
    } catch (e) {
      safeLog("error", [`[view:${view.id}] effect threw`, String((e as Error)?.message ?? e)]);
    }
  }
}

// ---------------------------------------------------------------------------
// Hooks (state + effect) — minimal, opinionated subset
// ---------------------------------------------------------------------------

interface StateSlot<T> {
  kind: "state";
  value: T;
}

interface EffectSlot {
  kind: "effect";
  deps: unknown[] | undefined;
  cleanup?: () => void;
}

function useState<T>(initial: T): [T, (next: T) => void] {
  const view = renderingView;
  if (!view) {
    throw new Error("ui.useState can only be called inside a view's render function");
  }
  const cursor = view.hookCursor++;
  const existing = view.hooks[cursor] as StateSlot<T> | undefined;
  if (!existing) {
    view.hooks[cursor] = { kind: "state", value: initial } satisfies StateSlot<T>;
  }
  const slot = view.hooks[cursor] as StateSlot<T>;
  const setter = (next: T) => {
    slot.value = next;
    // Coalesce multiple setState calls in a single handler by deferring
    // to a microtask. Without this, three setState calls inside one
    // onClick would post three `worker:update-view` messages.
    queueMicrotaskOnce(view);
  };
  return [slot.value, setter];
}

const scheduledViews = new Set<string>();
function queueMicrotaskOnce(view: ViewState) {
  if (scheduledViews.has(view.id)) return;
  scheduledViews.add(view.id);
  queueMicrotask(() => {
    scheduledViews.delete(view.id);
    if (views.has(view.id)) {
      renderView(view, { isInitial: false });
    }
  });
}

function useEffect(effect: () => void | (() => void), deps?: unknown[]): void {
  const view = renderingView;
  if (!view) {
    throw new Error("ui.useEffect can only be called inside a view's render function");
  }
  const cursor = view.hookCursor++;
  const prev = view.hooks[cursor] as EffectSlot | undefined;

  const shouldRun =
    !prev || !deps || !prev.deps || !depsEqual(prev.deps, deps);

  if (shouldRun) {
    effectQueue.push(() => {
      if (prev?.cleanup) {
        try {
          prev.cleanup();
        } catch (e) {
          safeLog("error", [`[view:${view.id}] effect cleanup threw`, String((e as Error)?.message ?? e)]);
        }
      }
      const result = effect();
      const slot: EffectSlot = {
        kind: "effect",
        deps,
        cleanup: typeof result === "function" ? result : undefined,
      };
      view.hooks[cursor] = slot;
    });
  }
}

function depsEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Building the `ctx` surface
// ---------------------------------------------------------------------------

function buildCtx(): GuestCtx {
  const registerView = (panel: "left" | "right") => async (view: GuestView) => {
    if (!view || typeof view !== "object" || typeof view.id !== "string" || typeof view.title !== "string") {
      throw new Error("registerView: invalid view descriptor");
    }
    if (typeof view.render !== "function") {
      throw new Error("registerView: `render` must be a function");
    }
    const existing = views.get(view.id);
    if (existing) {
      // Re-registration replaces the render function but keeps hook
      // state — matches the legacy behaviour where an extension could
      // re-register the same view id without losing its counter.
      existing.render = view.render as (ctx: GuestCtx) => UiNode;
      existing.title = view.title;
      existing.panel = panel;
      existing.icon = view.icon
        ? { kind: "lucide", name: view.icon.name, size: view.icon.size, className: view.icon.className }
        : undefined;
      renderView(existing, { isInitial: false });
      return;
    }
    const state: ViewState = {
      id: view.id,
      panel,
      title: view.title,
      icon: view.icon
        ? { kind: "lucide", name: view.icon.name, size: view.icon.size, className: view.icon.className }
        : undefined,
      render: view.render as (ctx: GuestCtx) => UiNode,
      hooks: [],
      hookCursor: 0,
      handlers: new Map(),
      handlerSeq: 0,
    };
    views.set(view.id, state);
    renderView(state, { isInitial: true });
  };

  return {
    commands: {
      registerCommand: (id, callback) => {
        // Commands that callback into the worker need a handler id too
        // — host will route `executeCommand` back through
        // `host:ui-event` with this id.
        const handlerId = `command:${id}`;
        commandHandlers.set(handlerId, callback);
        return request("commands:register", "register", { id, handlerId }) as Promise<void>;
      },
      executeCommand: (id, ...args) =>
        request("commands:execute", "execute", { id, args }),
    },
    window: {
      registerRightPanelView: registerView("right"),
      registerLeftPanelView: registerView("left"),
      showInformationMessage: (msg) =>
        request("ui:show-message", "showInformationMessage", { message: String(msg) }) as Promise<void>,
    },
    l10n: {
      registerTranslations: async (locale, bundle) => {
        // Keep a mirror in the worker so `t()` stays synchronous.
        const existing = l10nBundles.get(locale) ?? {};
        l10nBundles.set(locale, { ...existing, ...bundle });
        for (const fn of localeListeners) {
          try { fn(); } catch { /* swallow listener errors */ }
        }
        await request("l10n:register", "register", { locale, bundle });
      },
      t: (key, params) => {
        const bundle = l10nBundles.get(currentLocale) ?? l10nBundles.get("en") ?? {};
        let text = bundle[key] || key;
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            text = text.replace(new RegExp(`\\{${k}\\}`, "g"), v);
          }
        }
        return text;
      },
      getLocale: () => currentLocale,
      subscribe: (listener) => {
        localeListeners.add(listener);
        return () => localeListeners.delete(listener);
      },
    },
    languages: {
      register: (language) => request("lang:register", "register", language) as Promise<void>,
      setMonarchTokens: (id, rules) =>
        request("lang:register", "setMonarchTokens", { id, rules }) as Promise<void>,
      setConfiguration: (id, config) =>
        request("lang:register", "setConfiguration", { id, config }) as Promise<void>,
      setIndentation: (id, options) =>
        request("lang:register", "setIndentation", { id, options }) as Promise<void>,
    },
    storage: {
      get: ((key: string, defaultValue: unknown) =>
        request("storage:read", "get", { key, defaultValue })) as GuestCtx["storage"]["get"],
      set: (key, value) => request("storage:write", "set", { key, value }) as Promise<void>,
    },
    clipboard: {
      writeText: (text) => request("clipboard:write", "writeText", { text }) as Promise<void>,
    },
    workspace: {
      readFile: (path) => request("fs:read", "readFile", { path }) as Promise<string>,
      writeFile: (path, content) => request("fs:write", "writeFile", { path, content }) as Promise<void>,
      search: (query) => request("workspace:search", "search", { query }),
      info: () => request("workspace:info", "info", {}),
    },
    ui: {
      useState,
      useEffect,
    },
  };
}

const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();

// ---------------------------------------------------------------------------
// Host → Worker message handling
// ---------------------------------------------------------------------------

async function handleInit(msg: Extract<HostMessage, { kind: "host:init" }>) {
  extensionId = msg.extensionId;
  grantedCapabilities = new Set(msg.grantedCapabilities);
  currentLocale = msg.locale;

  // Build the ctx AFTER setting the granted set so capability checks on
  // bound closures see the right permissions.
  const ctx = buildCtx();

  // Prune dangerous globals before running third-party code. A hostile
  // extension inside the worker can still try to reach these via
  // `globalThis`, but every removal is one more step between the code
  // and the network.
  //
  // We keep `postMessage` intact because the bridge needs it, but we
  // wrap it so an extension calling it directly hits a type error
  // instead of being able to craft its own host messages.
  try {
    const g = self as unknown as Record<string, unknown>;
    const neutralise = (name: string) => {
      try {
        Object.defineProperty(g, name, {
          value: () => {
            throw new Error(`${name} is not available inside the extension sandbox`);
          },
          configurable: false,
          writable: false,
        });
      } catch { /* already gone or non-configurable */ }
    };
    neutralise("fetch");
    neutralise("XMLHttpRequest");
    neutralise("importScripts");
    neutralise("WebSocket");
    neutralise("EventSource");
  } catch (e) {
    safeLog("warn", ["Failed to neutralise globals", String((e as Error)?.message ?? e)]);
  }

  // Evaluate the extension in the worker realm. `new Function` pins the
  // scope chain to global — no access to the module's locals (pending,
  // views, grantedCapabilities, …) except through `ctx`.
  try {
    const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
    const runner = new Function(
      "module",
      "exports",
      "ctx",
      "console",
      msg.script,
    );

    // Provide a minimal `console` shim that routes to the host.
    const guestConsole = {
      log: (...args: unknown[]) => safeLog("debug", args),
      debug: (...args: unknown[]) => safeLog("debug", args),
      info: (...args: unknown[]) => safeLog("debug", args),
      warn: (...args: unknown[]) => safeLog("warn", args),
      error: (...args: unknown[]) => safeLog("error", args),
    };

    runner(moduleObj, moduleObj.exports, ctx, guestConsole);

    const activate = (moduleObj.exports as { activate?: (ctx: GuestCtx) => unknown }).activate
      ?? (moduleObj.exports as { default?: { activate?: (ctx: GuestCtx) => unknown } }).default?.activate;

    if (typeof activate === "function") {
      await activate(ctx);
    } else {
      safeLog("warn", [`[${extensionId}] extension did not export an \`activate\` function`]);
    }

    postToHost({ kind: "worker:ready", ok: true });
  } catch (e) {
    const err = e as Error;
    postToHost({
      kind: "worker:ready",
      ok: false,
      error: { name: err?.name ?? "Error", message: err?.message ?? String(e) },
    });
  }
}

function handleResponse(msg: Extract<HostMessage, { kind: "host:response" | "host:error" }>) {
  const resolver = pending.get(msg.id);
  if (!resolver) return;
  pending.delete(msg.id);
  if (msg.kind === "host:response" && msg.ok) {
    resolver.resolve(msg.value);
  } else if (msg.kind === "host:error") {
    const err = new Error(msg.error.message);
    err.name = msg.error.name;
    resolver.reject(err);
  }
}

function handleHostEvent(msg: Extract<HostMessage, { kind: "host:event" }>) {
  if (msg.topic === "locale-changed" && typeof msg.payload === "string") {
    currentLocale = msg.payload;
    for (const listener of localeListeners) {
      try { listener(); } catch { /* swallow */ }
    }
    // Re-render all views so translated strings update on locale change.
    for (const view of views.values()) {
      renderView(view, { isInitial: false });
    }
  }
}

function handleUiEvent(msg: Extract<HostMessage, { kind: "host:ui-event" }>) {
  const handlerId = msg.handlerId;
  // Commands get a distinct prefix so they can be routed through the same
  // channel without colliding with UI handler ids.
  if (handlerId.startsWith("command:")) {
    const cmdHandler = commandHandlers.get(handlerId);
    if (cmdHandler) {
      try {
        cmdHandler(...(Array.isArray(msg.args) ? msg.args : []));
      } catch (e) {
        safeLog("error", [`[command] handler threw`, String((e as Error)?.message ?? e)]);
      }
    }
    return;
  }

  // UI handler ids look like `<viewId>:<seq>`.
  const colon = handlerId.indexOf(":");
  if (colon < 0) return;
  const viewId = handlerId.slice(0, colon);
  const view = views.get(viewId);
  const handler = view?.handlers.get(handlerId);
  if (!handler) return;
  try {
    handler(...(Array.isArray(msg.args) ? msg.args : []));
  } catch (e) {
    safeLog("error", [`[view:${viewId}] handler threw`, String((e as Error)?.message ?? e)]);
  }
}

self.addEventListener("message", ((event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object" || typeof (msg as { kind: unknown }).kind !== "string") {
    // Drop anything that doesn't look like a protocol message. The type
    // guard also rejects `null`/`undefined` which otherwise crash the
    // switch.
    return;
  }
  switch (msg.kind) {
    case "host:init":
      // Only process the first init. A hostile main-thread impersonator
      // can't sneak a second one in because workers only receive messages
      // from their parent.
      if (extensionId) {
        safeLog("warn", ["host:init received twice — ignoring"]);
        return;
      }
      // Validate capabilities at the bridge boundary so a corrupted
      // persisted grant can't expand the worker's surface.
      {
        const filtered = (msg.grantedCapabilities || []).filter(isKnownCapability);
        handleInit({ ...msg, grantedCapabilities: filtered });
      }
      break;
    case "host:response":
    case "host:error":
      handleResponse(msg);
      break;
    case "host:event":
      handleHostEvent(msg);
      break;
    case "host:ui-event":
      handleUiEvent(msg);
      break;
  }
}) as (event: Event) => void);

// Global error handlers — report to host rather than letting the worker
// crash silently.
self.addEventListener("error", ((event: ErrorEvent) => {
  safeLog("error", [
    "Uncaught error in extension",
    event.message,
    event.filename,
    event.lineno,
    event.colno,
  ]);
}) as (event: Event) => void);

self.addEventListener("unhandledrejection", ((event: PromiseRejectionEvent) => {
  safeLog("error", ["Unhandled promise rejection", String(event.reason)]);
}) as (event: Event) => void);
