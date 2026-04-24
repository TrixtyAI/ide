/**
 * Host-side extension sandbox.
 *
 * Responsibilities:
 * - Spawn a Web Worker per external extension (`TrixtySandbox.load`).
 * - Dispatch `worker:request` messages through a capability-gated
 *   handler table into the host `trixty.*` singletons and Tauri IPC.
 * - Reflect worker-driven view registrations onto the host's
 *   `trixty.window` registry so the existing `LeftSidebarSlot` /
 *   `RightPanelSlot` components don't need to know a view came from a
 *   sandbox.
 * - Route UI events from the host React tree back to the worker so
 *   button clicks / input changes in a sandboxed panel reach the
 *   extension's own callbacks.
 * - Enforce timeouts, crash recovery, and a one-time termination
 *   invariant so an extension that keeps posting to a dead bridge
 *   doesn't leak promises.
 *
 * What this module *does not* do:
 * - Execute third-party code in the host realm. That happens exclusively
 *   inside the worker.
 * - Decide which capabilities are granted. That is the approval flow's
 *   job; the sandbox trusts whatever list it receives.
 */

import React from "react";
import * as LucideIcons from "lucide-react";
import { trixty } from "@/api/trixty";
import { trixtyStore } from "@/api/store";
import { safeInvoke, isTauri } from "@/api/tauri";
import { logger } from "@/lib/logger";
import SandboxUIRenderer from "@/components/SandboxUIRenderer";
import {
  CapabilityDeniedError,
  SandboxTimeoutError,
  type Capability,
  type HostMessage,
  type WorkerMessage,
} from "./types";
import { sanitizeUiNode, type UiNode } from "./uiSchema";
import { EXTENSION_WORKER_SOURCE } from "./extensionWorkerSource.generated";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const READY_TIMEOUT_MS = 15_000;

/** Per-extension storage key prefix, so `storage:read` / `storage:write`
 *  never leak data between extensions. Keys look like
 *  `trixty-ext-storage:<extensionId>:<userKey>`. */
const STORAGE_KEY_PREFIX = "trixty-ext-storage";

type UiEventEmitter = (handlerId: string, args: unknown[]) => void;

/** Per-view bookkeeping held by the host so schema updates and
 *  disposal have somewhere to point at. Each entry closes over a
 *  mutable `schema` cell that `SandboxUIRenderer` reads from. */
interface ViewEntry {
  unregister: () => void;
  emit: UiEventEmitter;
  /** Host-driven setter the `handleUpdateView` branch calls when the
   *  worker posts a new UI schema. */
  setSchema: (next: UiNode) => void;
}

/** Public handle to a spawned sandbox. Keeps enough state to tear the
 *  worker down cleanly and to route UI events back to it. */
export interface SandboxHandle {
  extensionId: string;
  worker: Worker;
  /** Views the worker has registered so far. The host component tree
   *  looks these up by id to render, but the actual registration on
   *  `trixty.window` is driven from here. */
  views: Map<string, ViewEntry>;
  /** True once `worker:ready` arrives. Blocks `invoke`-style calls
   *  until the extension has finished activating. */
  ready: Promise<void>;
  dispose: () => void;
}

/**
 * Spawn a sandboxed worker for an extension. Returns immediately — the
 * activation completes in the background; callers that need to know
 * whether `activate()` succeeded should await `handle.ready`.
 */
export function spawnExtensionWorker(params: {
  extensionId: string;
  script: string;
  grantedCapabilities: Capability[];
  requestTimeoutMs?: number;
}): SandboxHandle {
  const { extensionId, script, grantedCapabilities } = params;
  // Reserved for per-request timeout enforcement in a follow-up iteration;
  // `DEFAULT_REQUEST_TIMEOUT_MS` keeps the value self-documenting.
  void params.requestTimeoutMs;
  void DEFAULT_REQUEST_TIMEOUT_MS;

  const worker = createWorker();
  const views = new Map<string, ViewEntry>();
  let disposed = false;
  let resolveReady!: () => void;
  let rejectReady!: (e: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  // Guard against an extension that never answers `host:init`. Without
  // this, a broken extension would hold a dangling `ready` promise
  // forever.
  const readyTimer = setTimeout(() => {
    rejectReady(new SandboxTimeoutError(`Extension ${extensionId} did not become ready within ${READY_TIMEOUT_MS}ms`));
    dispose();
  }, READY_TIMEOUT_MS);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(readyTimer);
    for (const view of views.values()) {
      try { view.unregister(); } catch { /* swallow */ }
    }
    views.clear();
    try { worker.terminate(); } catch { /* swallow */ }
  };

  const postToWorker = (msg: HostMessage) => {
    if (disposed) return;
    try {
      worker.postMessage(msg);
    } catch (e) {
      logger.error(`[sandbox:${extensionId}] postMessage failed`, e);
    }
  };

  const handleRequest = async (msg: Extract<WorkerMessage, { kind: "worker:request" }>) => {
    // Every capability check happens HERE on the host side, not in the
    // worker — a hostile worker that bypassed its own sandbox guards
    // still can't reach the real API without the host approving the
    // capability.
    if (!(grantedCapabilities as readonly Capability[]).includes(msg.capability)) {
      postToWorker({
        kind: "host:error",
        id: msg.id,
        ok: false,
        error: {
          name: "CapabilityDeniedError",
          message: new CapabilityDeniedError(msg.capability).message,
        },
      });
      return;
    }

    try {
      const value = await dispatchCapability(extensionId, msg.capability, msg.method, msg.args);
      postToWorker({ kind: "host:response", id: msg.id, ok: true, value });
    } catch (e) {
      const err = e as Error;
      postToWorker({
        kind: "host:error",
        id: msg.id,
        ok: false,
        error: {
          name: err?.name ?? "Error",
          message: err?.message ?? String(e),
        },
      });
    }
  };

  const handleRegisterView = (
    msg: Extract<WorkerMessage, { kind: "worker:register-view" }>,
  ) => {
    // Capability check for view registration lives here too — a
    // manifest that forgot to request `ui:register-view` should be
    // unable to plant panels regardless of what the extension code tried.
    if (!grantedCapabilities.includes("ui:register-view")) {
      postToWorker({
        kind: "host:error",
        id: msg.id,
        ok: false,
        error: {
          name: "CapabilityDeniedError",
          message: new CapabilityDeniedError("ui:register-view").message,
        },
      });
      return;
    }

    const safeSchema = sanitizeUiNode(msg.schema);
    const viewId = String(msg.viewId);
    const iconNode = renderIcon(msg.icon);

    // Replace any previous registration for the same id so re-activating
    // an extension doesn't leak a duplicate panel.
    views.get(viewId)?.unregister();

    // `currentSchema` is the mutable cell shared between the host
    // dispatcher (which swaps in new schemas on `worker:update-view`)
    // and the React renderer (which reads it via `getSchema`). Wrapping
    // it in a closure keeps the state local to this view — nothing
    // else in the module can overwrite it.
    let currentSchema = safeSchema;
    const listeners = new Set<() => void>();
    const getSchema = () => currentSchema;
    const setSchema = (next: UiNode) => {
      currentSchema = next;
      for (const listener of listeners) listener();
    };

    const emit = (handlerId: string, args: unknown[]) => {
      postToWorker({ kind: "host:ui-event", handlerId, args });
    };

    const renderFn = () =>
      React.createElement(SandboxUIRenderer, {
        getSchema,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        emit,
      });

    const view = {
      id: viewId,
      title: String(msg.title ?? viewId),
      icon: iconNode,
      render: renderFn,
    };

    if (msg.panel === "left") {
      trixty.window.registerLeftPanelView(view);
    } else {
      trixty.window.registerRightPanelView(view);
    }

    views.set(viewId, {
      unregister: () => {
        // The `trixty` registries don't expose an `unregister` today —
        // leaving the view reference in place but replacing `render`
        // with a no-op is the least invasive way to retire it without
        // touching the existing registry shape. Adding a real
        // `unregisterView` on trixty.window is worth a follow-up PR,
        // but orthogonal to the sandbox change.
        const noopView = { ...view, render: () => null };
        if (msg.panel === "left") {
          trixty.window.registerLeftPanelView(noopView);
        } else {
          trixty.window.registerRightPanelView(noopView);
        }
      },
      emit,
      setSchema,
    });

    postToWorker({ kind: "host:response", id: msg.id, ok: true, value: undefined });
  };

  const handleUpdateView = (
    msg: Extract<WorkerMessage, { kind: "worker:update-view" }>,
  ) => {
    const entry = views.get(msg.viewId);
    if (!entry) return;
    entry.setSchema(sanitizeUiNode(msg.schema));
  };

  const handleMessage = (event: MessageEvent<WorkerMessage>) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object" || typeof (msg as { kind: unknown }).kind !== "string") {
      // Malformed messages are dropped silently. The worker uses
      // structured clone, so we should never actually see this — but
      // an attacker who somehow wrote to the worker's message port
      // would otherwise be able to crash the dispatcher with
      // `undefined.kind`.
      logger.warn(`[sandbox:${extensionId}] dropping malformed worker message`);
      return;
    }

    switch (msg.kind) {
      case "worker:request":
        handleRequest(msg);
        break;
      case "worker:register-view":
        handleRegisterView(msg);
        break;
      case "worker:update-view":
        handleUpdateView(msg);
        break;
      case "worker:ready":
        clearTimeout(readyTimer);
        if (msg.ok) {
          resolveReady();
        } else {
          rejectReady(new Error(msg.error?.message ?? "Extension failed to activate"));
          logger.error(`[sandbox:${extensionId}] activate threw`, msg.error);
        }
        break;
      case "worker:log":
        logWorker(extensionId, msg.level, msg.args);
        break;
    }
  };

  worker.addEventListener("message", handleMessage);
  worker.addEventListener("error", (event: ErrorEvent) => {
    logger.error(`[sandbox:${extensionId}] worker error`, event.message);
    rejectReady(new Error(`Worker crashed: ${event.message}`));
    dispose();
  });

  // Send the init message last, so message handlers are in place by the
  // time the worker starts asking for things.
  postToWorker({
    kind: "host:init",
    extensionId,
    script,
    grantedCapabilities,
    locale: trixty.l10n.getLocale(),
  });

  // Forward locale changes so the guest's synchronous `t()` stays in
  // sync with the host. Unsubscribed on dispose.
  const unsubLocale = trixty.l10n.subscribe(() => {
    postToWorker({ kind: "host:event", topic: "locale-changed", payload: trixty.l10n.getLocale() });
  });
  const composedDispose = () => {
    unsubLocale();
    dispose();
  };

  return {
    extensionId,
    worker,
    views,
    ready,
    dispose: composedDispose,
  };
}

/**
 * Spawn the sandbox worker.
 *
 * We ship the compiled bootstrap as an inline string
 * (`extensionWorkerSource.generated.ts`) and spawn the worker from a
 * `Blob` URL. Rationale:
 *
 * - Turbopack + Next 16 `output: "export"` does not emit a real worker
 *   chunk for `new Worker(new URL("./x", import.meta.url))` — the
 *   bootstrap ends up as a static media asset the browser won't
 *   execute.
 * - Tauri's `file://` webview adds further protocol quirks that make
 *   the standard-URL path unreliable on Windows in particular.
 * - Blob spawning works identically in every environment (Tauri
 *   production, Next dev, Vitest with jsdom) with zero config.
 *
 * The tradeoff is a committed generated file. `pnpm build:worker` has
 * to be rerun whenever the bootstrap source changes; CI enforces this
 * (see the Quality workflow) by diffing the regenerated output against
 * what the PR committed.
 */
function createWorker(): Worker {
  // Happy path — production and dev-server builds both reach this
  // branch. The inline source is ~14 KB post-bundle, so the Blob clone
  // is negligible compared to boot time.
  try {
    const blob = new Blob([EXTENSION_WORKER_SOURCE], {
      type: "application/javascript",
    });
    return new Worker(URL.createObjectURL(blob), {
      name: "trixty-extension-sandbox",
    });
  } catch (e) {
    // Vitest's node environment lacks a real `Blob` / `Worker` unless
    // the test explicitly stubs them. Emit a deliberately-broken stub
    // worker so the `SandboxHandle.ready` promise rejects cleanly and
    // tests can still exercise the dispatcher by calling
    // `worker.emitMessage(...)` on the stub.
    logger.warn("[sandbox] Blob worker spawn failed, using stub:", e);
    const stub = `self.postMessage({ kind: "worker:ready", ok: false, error: { name: "SandboxUnavailable", message: "Worker bootstrap failed to load" } });`;
    try {
      const blob = new Blob([stub], { type: "application/javascript" });
      return new Worker(URL.createObjectURL(blob));
    } catch {
      // If `Blob` itself is unavailable we're running in a truly
      // stripped environment. Return a minimal stub that satisfies the
      // `Worker` shape tests depend on.
      return new Worker("about:blank");
    }
  }
}

// ---------------------------------------------------------------------------
// Capability dispatcher
// ---------------------------------------------------------------------------

/**
 * Map a `(capability, method)` request from the worker onto the real host
 * API. Every branch is explicit so adding a new capability requires
 * adding a dispatch entry — no implicit "forward anything under this
 * namespace" fall-through.
 *
 * Arguments arrive as `unknown`; the dispatcher is responsible for
 * validating shape before calling the underlying host function.
 */
async function dispatchCapability(
  extensionId: string,
  capability: Capability,
  method: string,
  args: unknown,
): Promise<unknown> {
  const a = args as Record<string, unknown>;

  switch (capability) {
    case "ui:register-view":
      // Registration messages don't come through here — they're
      // handled as their own message kind so the worker can include
      // the schema.
      throw new Error("ui:register-view must use worker:register-view message");

    case "ui:show-message":
      if (method === "showInformationMessage") {
        const message = String(a?.message ?? "");
        trixty.window.showInformationMessage(message);
        return undefined;
      }
      break;

    case "ui:command-palette":
      // Reserved — command palette UX doesn't exist on the host yet,
      // but the capability is part of the vocabulary so manifests can
      // opt in ahead of the feature landing. Until then, surface a
      // clear error rather than silently succeeding.
      throw new Error("ui:command-palette is not yet implemented on the host");

    case "lang:register":
      if (method === "register") {
        const lang = args as { id?: unknown };
        if (typeof lang?.id !== "string") {
          throw new Error("lang:register: missing language id");
        }
        trixty.languages.register(args as Parameters<typeof trixty.languages.register>[0]);
        return undefined;
      }
      if (method === "setMonarchTokens") {
        trixty.languages.setMonarchTokens(
          String(a?.id ?? ""),
          a?.rules as Parameters<typeof trixty.languages.setMonarchTokens>[1],
        );
        return undefined;
      }
      if (method === "setConfiguration") {
        trixty.languages.setConfiguration(
          String(a?.id ?? ""),
          a?.config as Parameters<typeof trixty.languages.setConfiguration>[1],
        );
        return undefined;
      }
      if (method === "setIndentation") {
        const options = a?.options as { tabSize?: unknown; insertSpaces?: unknown } | undefined;
        if (!options || typeof options.tabSize !== "number" || typeof options.insertSpaces !== "boolean") {
          throw new Error("setIndentation: options must be { tabSize: number, insertSpaces: boolean }");
        }
        trixty.languages.setIndentation(String(a?.id ?? ""), {
          tabSize: options.tabSize,
          insertSpaces: options.insertSpaces,
        });
        return undefined;
      }
      break;

    case "l10n:register":
      if (method === "register") {
        const locale = String(a?.locale ?? "");
        const bundle = a?.bundle;
        if (!locale) throw new Error("l10n:register: missing locale");
        if (!bundle || typeof bundle !== "object") throw new Error("l10n:register: bundle must be an object");
        // Validate every key/value is a string before registering —
        // the l10n registry would otherwise happily store non-strings
        // and leak them into `t()` output.
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(bundle as Record<string, unknown>)) {
          if (typeof v === "string") clean[k] = v;
        }
        trixty.l10n.registerTranslations(locale, clean);
        return undefined;
      }
      break;

    case "commands:register":
      // Commands are special — registering routes the execution back
      // into the worker via `host:ui-event`. The sandbox handle keeps
      // a map so unregistering on dispose cleans up.
      if (method === "register") {
        const id = String(a?.id ?? "");
        // Not wired in this initial PR — it requires lifting the
        // command registry to route executions through the worker.
        // Surfacing an explicit "not implemented" keeps the surface
        // honest and the test matrix small.
        throw new Error(`commands:register is not yet wired for sandboxed extensions (tried to register '${id}')`);
      }
      break;

    case "commands:execute":
      if (method === "execute") {
        const id = String(a?.id ?? "");
        const callArgs = Array.isArray(a?.args) ? a.args : [];
        // The command registry is a typed union, but from the worker's
        // side we only know the id at runtime. Cast the method itself
        // to an untyped variadic function so the spread typechecks;
        // the real registry throws `Command <id> not found` for
        // anything the extension didn't register beforehand.
        const execute = trixty.commands.executeCommand as unknown as (
          id: string,
          ...args: unknown[]
        ) => unknown;
        return execute(id, ...callArgs);
      }
      break;

    case "storage:read":
      if (method === "get") {
        const key = `${STORAGE_KEY_PREFIX}:${extensionId}:${String(a?.key ?? "")}`;
        return trixtyStore.get(key, (a?.defaultValue as unknown) ?? null);
      }
      break;

    case "storage:write":
      if (method === "set") {
        const key = `${STORAGE_KEY_PREFIX}:${extensionId}:${String(a?.key ?? "")}`;
        await trixtyStore.set(key, a?.value);
        return undefined;
      }
      break;

    case "clipboard:write":
      if (method === "writeText") {
        const text = String(a?.text ?? "");
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        }
        return undefined;
      }
      break;

    case "fs:read":
      if (method === "readFile") {
        return safeInvoke("read_file", { path: String(a?.path ?? "") });
      }
      break;

    case "fs:write":
      if (method === "writeFile") {
        await safeInvoke("write_file", {
          path: String(a?.path ?? ""),
          content: String(a?.content ?? ""),
        });
        return undefined;
      }
      break;

    case "workspace:search":
      if (method === "search") {
        if (!isTauri()) return [];
        // Workspace root is tracked on the host; extensions can't pass
        // arbitrary roots to search to avoid escaping the current
        // workspace.
        const rootPath = await safeInvoke("get_recursive_file_list", { rootPath: null })
          .then(() => null) // placeholder — real root-path resolution lives in AppContext
          .catch(() => null);
        return safeInvoke("search_in_project", {
          query: String(a?.query ?? ""),
          rootPath: rootPath ?? "",
        });
      }
      break;

    case "workspace:info":
      if (method === "info") {
        return { locale: trixty.l10n.getLocale() };
      }
      break;
  }

  throw new Error(`Unknown capability/method: ${capability}/${method}`);
}

// ---------------------------------------------------------------------------
// Icon resolver
// ---------------------------------------------------------------------------

function renderIcon(
  icon: { kind: "lucide"; name: string; size?: number; className?: string } | undefined,
): React.ReactNode {
  if (!icon) return null;
  const iconMap = LucideIcons as unknown as Record<string, React.ComponentType<{ size?: number; className?: string }>>;
  const Component = iconMap[icon.name];
  if (!Component) return null;
  return React.createElement(Component, {
    size: icon.size ?? 14,
    className: icon.className,
  });
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function logWorker(extensionId: string, level: "debug" | "warn" | "error", args: unknown[]) {
  const prefix = `[ext:${extensionId}]`;
  switch (level) {
    case "debug":
      logger.debug(prefix, ...args);
      break;
    case "warn":
      logger.warn(prefix, ...args);
      break;
    case "error":
      logger.error(prefix, ...args);
      break;
  }
}
