"use client";

import { isTauri } from "@/api/tauri";
import { logger } from "@/lib/logger";

/**
 * Each Tauri WebviewWindow runs its own JS realm. To sync mutable
 * state slices (chat history, terminal tabs, …) between the main
 * shell and any detached floating window, we broadcast a Tauri event
 * tagged with the originating window's session id and ignore loopbacks
 * inside the same realm.
 *
 * `WINDOW_SESSION_ID` is minted once per JS realm — stable for the
 * lifetime of the window, but distinct between main + floating
 * windows even when they share the same process.
 */
export const WINDOW_SESSION_ID = (() => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Older runtimes without `randomUUID` still expose WebCrypto's
  // `getRandomValues`. We use it instead of `Math.random` so the id is
  // unpredictable enough that any future security-sensitive use of
  // `WINDOW_SESSION_ID` stays safe.
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return `win-${buf[0].toString(36)}${buf[1].toString(36)}-${Date.now()}`;
  }
  // Last-resort fallback for environments without WebCrypto (very old
  // jsdom, etc.). The id is only used to suppress event echos; in this
  // path collisions only cause a duplicate apply, which our consumers
  // already handle idempotently.
  return `win-${Date.now().toString(36)}-${performance.now().toString(36)}`;
})();

/**
 * Tauri event name used by the cross-window sync channel. `<key>`
 * identifies the state slice (e.g. `chat`); the payload always
 * carries `{ sender, data }` so receivers can drop their own echos.
 */
const SYNC_EVENT_PREFIX = "trixty:state-sync:";

interface SyncPayload<T> {
  sender: string;
  data: T;
}

/**
 * Broadcast a state slice to every other Tauri window. The current
 * window NEVER sees its own broadcast (Tauri's emit doesn't loop back,
 * and the sender check below is belt + suspenders for shared-realm
 * test harnesses).
 *
 * Outside Tauri (e.g. `next dev` in a regular browser, vitest) this
 * is a no-op so callers don't have to gate every emit on `isTauri()`.
 */
export async function broadcastState<T>(key: string, data: T): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(`${SYNC_EVENT_PREFIX}${key}`, {
      sender: WINDOW_SESSION_ID,
      data,
    } satisfies SyncPayload<T>);
  } catch (err) {
    logger.debug(`[crossWindowSync] broadcast(${key}) failed:`, err);
  }
}

/**
 * Subscribe to broadcasts of a state slice from other Tauri windows.
 * Returns an `unlisten` function the caller passes to its useEffect
 * cleanup. The handler only runs for events whose `sender` differs
 * from the current window's session id, so a window NEVER applies
 * its own broadcast.
 *
 * If the underlying `listen` registration fails (transport down,
 * Tauri unavailable) the returned cleanup is still safe to call —
 * we resolve a noop instead of throwing.
 */
export async function subscribeToBroadcasts<T>(
  key: string,
  handler: (data: T) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<SyncPayload<T>>(
      `${SYNC_EVENT_PREFIX}${key}`,
      (event) => {
        const payload = event.payload;
        if (!payload || typeof payload !== "object") return;
        if (payload.sender === WINDOW_SESSION_ID) return;
        handler(payload.data);
      },
    );
    return unlisten;
  } catch (err) {
    logger.debug(`[crossWindowSync] subscribe(${key}) failed:`, err);
    return () => undefined;
  }
}
