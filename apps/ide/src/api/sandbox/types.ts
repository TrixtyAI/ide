/**
 * Shared message contract between the extension host (main thread) and the
 * extension worker (untrusted guest). Both sides import these types so the
 * discriminated unions stay in sync, and any change to the protocol surfaces
 * as a TS error at every call site instead of silently deserializing to
 * `unknown`.
 *
 * ## Why message types are so restrictive
 *
 * The worker runs third-party code we do not trust. That means:
 *
 * 1. Every host handler MUST treat the `payload` as untrusted input and
 *    validate before use. The types here are a *contract*, not a guard —
 *    a hostile worker can send any bytes it wants.
 * 2. Every response carries an explicit `id` so we can correlate
 *    request/response pairs and tear down pending promises on worker crash
 *    without leaking. A request without a matching `id` is dropped.
 * 3. UI intents only reference primitive, JSON-serialisable values.
 *    Functions / DOM nodes / React elements cannot cross the wire, which is
 *    the whole point: it prevents the worker from smuggling closures that
 *    close over host state.
 */

import type { UiNode } from "./uiSchema";

/**
 * Fixed capability vocabulary. Adding a new capability requires adding it
 * here first — this is deliberate so the allow-list cannot be widened
 * accidentally by a user typo in an extension's `package.json`.
 *
 * Capabilities map roughly 1:1 to method groups on the `trixty` API:
 * - `ui:*`         → `trixty.window.*` (register views, show toasts)
 * - `lang:*`       → `trixty.languages.*` (Monaco registration)
 * - `l10n:*`       → `trixty.l10n.*` (translations)
 * - `commands:*`   → `trixty.commands.*` (register / execute commands)
 * - `storage:*`    → key-value store per extension (namespaced in
 *                    `trixtyStore` — NOT shared across extensions)
 * - `clipboard:*`  → `navigator.clipboard.writeText`
 * - `fs:*`         → Tauri FS commands (scoped to workspace root by the
 *                    existing Rust guard). Read/write are separate so a
 *                    read-only extension cannot corrupt files if it is
 *                    compromised.
 * - `workspace:*`  → workspace metadata + search
 *
 * The `legacy:*` prefix is reserved for backwards compatibility escape
 * hatches; none are currently defined.
 */
export const KNOWN_CAPABILITIES = [
  "ui:register-view",
  "ui:show-message",
  "ui:command-palette",
  "lang:register",
  "l10n:register",
  "commands:register",
  "commands:execute",
  "storage:read",
  "storage:write",
  "clipboard:write",
  "fs:read",
  "fs:write",
  "workspace:search",
  "workspace:info",
] as const;

export type Capability = (typeof KNOWN_CAPABILITIES)[number];

/** Runtime type guard — used when parsing an untrusted manifest string. */
export function isKnownCapability(value: unknown): value is Capability {
  return typeof value === "string" && (KNOWN_CAPABILITIES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Host → Worker messages
// ---------------------------------------------------------------------------

/** The worker is booting for the first time; host hands over its config. */
export interface HostInitMessage {
  kind: "host:init";
  extensionId: string;
  /** Source of the extension's `index.js` — evaluated with `importScripts`
   *  or `new Function` *inside* the worker realm, not in the host. */
  script: string;
  /** Capabilities that the user has approved for this extension. The worker
   *  uses this to shape its own `ctx` proxy (methods for revoked
   *  capabilities throw synchronously before even emitting a request). */
  grantedCapabilities: Capability[];
  /** Current locale so the worker's initial `l10n.t()` calls return the
   *  right strings without a round-trip. */
  locale: string;
}

/** The host is satisfying a previous `worker:request` with a value. */
export interface HostResponseMessage {
  kind: "host:response";
  /** Correlates with the `worker:request.id` that prompted this reply. */
  id: number;
  ok: true;
  value: unknown;
}

/** The host is satisfying a previous `worker:request` with an error. */
export interface HostErrorMessage {
  kind: "host:error";
  id: number;
  ok: false;
  /** Serialised error — Error instances don't cross the structured clone
   *  boundary cleanly, so we reduce to { name, message }. */
  error: { name: string; message: string };
}

/** Host pushes a value-change event the worker asked to subscribe to
 *  (locale changes, for now). */
export interface HostEventMessage {
  kind: "host:event";
  topic: "locale-changed" | "view-event";
  payload: unknown;
}

/** Host invokes a UI event handler the worker registered as part of a
 *  UI schema (button click, input change, unmount, …). */
export interface HostUiEventMessage {
  kind: "host:ui-event";
  handlerId: string;
  /** Event payload, e.g. `{ value: "..." }` for an input change. Kept
   *  narrow and JSON-only — no DOM events cross the wire. */
  args: unknown[];
}

export type HostMessage =
  | HostInitMessage
  | HostResponseMessage
  | HostErrorMessage
  | HostEventMessage
  | HostUiEventMessage;

// ---------------------------------------------------------------------------
// Worker → Host messages
// ---------------------------------------------------------------------------

/** Worker wants to call a host-side capability. Host checks the extension's
 *  grant list, executes if allowed, replies with `host:response` or
 *  `host:error`. */
export interface WorkerRequestMessage {
  kind: "worker:request";
  id: number;
  /** Capability namespace the request falls under. Host verifies this
   *  against the extension's grants BEFORE touching `method`. */
  capability: Capability;
  /** Free-form method name scoped to the capability (e.g. `capability:
   *  "fs:read"`, method: `"read_file"`). */
  method: string;
  /** Plain-JSON arguments — structured clone only. */
  args: unknown;
}

/** Worker is asking the host to render / update / remove a panel view. */
export interface WorkerRegisterViewMessage {
  kind: "worker:register-view";
  id: number;
  viewId: string;
  panel: "left" | "right";
  title: string;
  icon?: { kind: "lucide"; name: string; size?: number; className?: string };
  /** Current UI schema for this view. Replaces any previous schema. */
  schema: UiNode;
}

/** Worker is pushing a new UI schema for a view it previously registered
 *  (i.e. a re-render triggered by its own state change). */
export interface WorkerUpdateViewMessage {
  kind: "worker:update-view";
  viewId: string;
  schema: UiNode;
}

/** Extension's activate() finished — or threw. Used for lifecycle
 *  observability and to time out pending `host:init`. */
export interface WorkerReadyMessage {
  kind: "worker:ready";
  ok: boolean;
  error?: { name: string; message: string };
}

/** Worker caught an uncaught error at any point — host logs it and may
 *  surface a notification. */
export interface WorkerLogMessage {
  kind: "worker:log";
  level: "debug" | "warn" | "error";
  args: unknown[];
}

export type WorkerMessage =
  | WorkerRequestMessage
  | WorkerRegisterViewMessage
  | WorkerUpdateViewMessage
  | WorkerReadyMessage
  | WorkerLogMessage;

/** Returned by `TrixtySandbox.invoke()` when the worker doesn't reply within
 *  the configured timeout. Separate class so callers can special-case it
 *  (e.g. flag the extension as unresponsive). */
export class SandboxTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxTimeoutError";
  }
}

/** Returned when the worker asks for a capability it wasn't granted. */
export class CapabilityDeniedError extends Error {
  constructor(public readonly capability: string) {
    super(`Capability '${capability}' was not granted for this extension`);
    this.name = "CapabilityDeniedError";
  }
}
