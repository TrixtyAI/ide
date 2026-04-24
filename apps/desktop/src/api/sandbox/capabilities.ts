/**
 * Capability manifest parsing, approval persistence, and change detection.
 *
 * Approval flow:
 * 1. On extension load, the host reads `package.json` (via
 *    `fetch_extension_file` / `read_extension_script`'s sibling path) and
 *    extracts `trixty.capabilities`.
 * 2. It compares the requested set against the set the user previously
 *    approved (persisted in `trixtyStore` under `trixty-extension-grants`,
 *    v1 envelope).
 * 3. If anything new is requested, the host surfaces the approval modal.
 *    Denied grants are persisted too, so a user who said "no" isn't prompted
 *    again on every launch.
 * 4. Once approved, the host spawns the worker with the final grant list.
 *
 * Legacy manifests that omit `trixty.capabilities` entirely are treated as
 * requesting the pre-sandbox "everything" set; the host surfaces this as an
 * explicit warning in the modal so the user knows they're granting more
 * than a modern manifest would. This lets existing community extensions
 * keep working through a single "approve legacy access" click.
 */

import { trixtyStore } from "@/api/store";
import {
  isKnownCapability,
  type Capability,
  KNOWN_CAPABILITIES,
} from "./types";

const GRANTS_STORE_KEY = "trixty-extension-grants";
const GRANTS_STORE_VERSION = 1;

/** Per-extension approval record. A capability appears in exactly one of
 * `granted` / `denied`; asking the user a second time for the same
 * capability only happens if the extension *requests* one that's in
 * neither list. */
export interface ExtensionGrants {
  /** Last-seen request set — if the extension changes its requests we
   *  re-prompt for the diff. */
  requested: Capability[];
  granted: Capability[];
  denied: Capability[];
  /** Epoch millis of the last approval decision. Purely informational. */
  decidedAt: number;
}

/** Shape persisted to disk. Keyed by extension id. */
export type GrantsMap = Record<string, ExtensionGrants>;

/** Human-readable descriptions used by the approval modal. Kept in this
 * module so the vocabulary and its UX prose stay close together; a new
 * capability won't land without someone having to write copy for it. */
export const CAPABILITY_DESCRIPTIONS: Record<Capability, string> = {
  "ui:register-view": "Add panels to the sidebar or right pane.",
  "ui:show-message": "Show toast-style notifications.",
  "ui:command-palette": "Contribute items to the command palette.",
  "lang:register": "Register syntax highlighting for new file types.",
  "l10n:register": "Ship translations into the UI.",
  "commands:register": "Register commands other extensions can execute.",
  "commands:execute": "Trigger commands registered elsewhere.",
  "storage:read": "Read its own private key-value settings.",
  "storage:write": "Write to its own private key-value settings.",
  "clipboard:write": "Copy text to your system clipboard.",
  "fs:read": "Read files inside your current workspace.",
  "fs:write": "Create, modify, or delete files in your workspace.",
  "workspace:search": "Search across files in your workspace.",
  "workspace:info": "Read metadata about the current workspace.",
};

/** Parses `trixty.capabilities` out of an extension's `package.json` JSON
 *  string. Defensive: the file is produced by a third party, so every
 *  field shape is checked before use. */
export function parseManifestCapabilities(packageJsonText: string): {
  capabilities: Capability[];
  unknown: string[];
  legacy: boolean;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    // A manifest that isn't valid JSON can't ship a capability list — treat
    // it as legacy and let the install path report the parse error
    // separately.
    return { capabilities: [], unknown: [], legacy: true };
  }

  if (!parsed || typeof parsed !== "object") {
    return { capabilities: [], unknown: [], legacy: true };
  }

  const trixtyField = (parsed as Record<string, unknown>).trixty;
  if (!trixtyField || typeof trixtyField !== "object") {
    // No `trixty` block at all → legacy extension, pre-sandbox.
    return { capabilities: [], unknown: [], legacy: true };
  }

  const capField = (trixtyField as Record<string, unknown>).capabilities;
  if (!Array.isArray(capField)) {
    // `trixty` is present but has no `capabilities` array. Treat as "no
    // capabilities requested" — the extension gets a hollow bridge and
    // can only register itself as inert. Not legacy, just empty.
    return { capabilities: [], unknown: [], legacy: false };
  }

  const capabilities: Capability[] = [];
  const unknown: string[] = [];
  for (const entry of capField) {
    if (isKnownCapability(entry)) {
      // Deduplicate — a manifest listing `fs:read` twice shouldn't make
      // us ask the user twice.
      if (!capabilities.includes(entry)) capabilities.push(entry);
    } else if (typeof entry === "string") {
      unknown.push(entry);
    }
  }

  return { capabilities, unknown, legacy: false };
}

/** Default "everything" grant for a legacy extension whose manifest lacks
 *  a capability block. The approval modal flags this set with an explicit
 *  warning so the user knows what they're agreeing to. */
export function legacyCapabilitySet(): Capability[] {
  return [...KNOWN_CAPABILITIES];
}

/** Reads all stored grants. Never throws — a corrupted envelope resets to
 *  an empty map so a single bad write doesn't brick every extension. */
export async function loadAllGrants(): Promise<GrantsMap> {
  return trixtyStore.getVersioned<GrantsMap>(
    GRANTS_STORE_KEY,
    GRANTS_STORE_VERSION,
    {},
  );
}

/** Persists the entire grants map. Callers should `loadAllGrants` first,
 *  mutate, then pass the whole object in. */
export async function saveAllGrants(grants: GrantsMap): Promise<void> {
  await trixtyStore.setVersioned(
    GRANTS_STORE_KEY,
    grants,
    GRANTS_STORE_VERSION,
  );
}

/** Capability diff used by the approval flow and the re-prompt trigger. */
export interface CapabilityDiff {
  /** Capabilities the extension is requesting that the user hasn't seen. */
  pendingApproval: Capability[];
  /** Capabilities already approved — carry forward without prompting. */
  alreadyGranted: Capability[];
  /** Capabilities the user previously denied; we block silently. */
  alreadyDenied: Capability[];
  /** Capabilities the extension used to request but no longer does.
   *  Informational only — we don't revoke grants for things the extension
   *  no longer wants, because nothing is happening that needs them. */
  droppedByExtension: Capability[];
}

/** Computes the diff between a freshly-parsed manifest and a previously
 *  persisted grant record. */
export function diffCapabilities(
  requested: Capability[],
  previous: ExtensionGrants | undefined,
): CapabilityDiff {
  const prevGranted = new Set(previous?.granted ?? []);
  const prevDenied = new Set(previous?.denied ?? []);
  const prevRequested = new Set(previous?.requested ?? []);
  const nextRequested = new Set(requested);

  const pendingApproval: Capability[] = [];
  const alreadyGranted: Capability[] = [];
  const alreadyDenied: Capability[] = [];

  for (const cap of requested) {
    if (prevGranted.has(cap)) alreadyGranted.push(cap);
    else if (prevDenied.has(cap)) alreadyDenied.push(cap);
    else pendingApproval.push(cap);
  }

  const droppedByExtension: Capability[] = [];
  for (const cap of prevRequested) {
    if (!nextRequested.has(cap)) droppedByExtension.push(cap);
  }

  return {
    pendingApproval,
    alreadyGranted,
    alreadyDenied,
    droppedByExtension,
  };
}

/** Writes the user's decision into the persisted grant map for a single
 *  extension. Pass `approved = []` to explicitly deny everything. */
export async function persistDecision(params: {
  extensionId: string;
  requested: Capability[];
  approved: Capability[];
  denied: Capability[];
  existingGrants: GrantsMap;
}): Promise<GrantsMap> {
  const { extensionId, requested, approved, denied, existingGrants } = params;
  const prev = existingGrants[extensionId];

  // Merge with previous decisions so "I approved X three launches ago" is
  // preserved across a manifest bump that doesn't touch X.
  const merged: ExtensionGrants = {
    requested,
    granted: dedupe([...(prev?.granted ?? []), ...approved]).filter((c) =>
      requested.includes(c),
    ),
    denied: dedupe([...(prev?.denied ?? []), ...denied]).filter((c) =>
      requested.includes(c),
    ),
    decidedAt: Date.now(),
  };

  const next = { ...existingGrants, [extensionId]: merged };
  await saveAllGrants(next);
  return next;
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

/** Extracts the final granted set for a given extension record. Safe on
 *  an unknown extension id (returns `[]`). */
export function effectiveGrants(
  grants: GrantsMap,
  extensionId: string,
): Capability[] {
  return grants[extensionId]?.granted ?? [];
}
