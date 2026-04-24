import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAPABILITY_DESCRIPTIONS,
  diffCapabilities,
  effectiveGrants,
  legacyCapabilitySet,
  loadAllGrants,
  parseManifestCapabilities,
  persistDecision,
} from "./capabilities";
import { KNOWN_CAPABILITIES } from "./types";

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
  vi.stubGlobal("window", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseManifestCapabilities", () => {
  it("extracts a valid capability array from `trixty.capabilities`", () => {
    const pkg = JSON.stringify({
      name: "x",
      trixty: { capabilities: ["fs:read", "ui:show-message"] },
    });
    const parsed = parseManifestCapabilities(pkg);
    expect(parsed.capabilities).toEqual(["fs:read", "ui:show-message"]);
    expect(parsed.legacy).toBe(false);
    expect(parsed.unknown).toEqual([]);
  });

  it("deduplicates repeated entries", () => {
    const pkg = JSON.stringify({
      trixty: { capabilities: ["fs:read", "fs:read", "ui:show-message"] },
    });
    expect(parseManifestCapabilities(pkg).capabilities).toEqual([
      "fs:read",
      "ui:show-message",
    ]);
  });

  it("collects unknown capability strings for logging", () => {
    const pkg = JSON.stringify({
      trixty: { capabilities: ["fs:read", "fs:EXEC_SHELL", 123] },
    });
    const parsed = parseManifestCapabilities(pkg);
    expect(parsed.capabilities).toEqual(["fs:read"]);
    expect(parsed.unknown).toEqual(["fs:EXEC_SHELL"]);
  });

  it("treats a manifest without a `trixty` block as legacy", () => {
    const pkg = JSON.stringify({ name: "x", main: "index.js" });
    const parsed = parseManifestCapabilities(pkg);
    expect(parsed.legacy).toBe(true);
    expect(parsed.capabilities).toEqual([]);
  });

  it("treats a `trixty` block with no capabilities array as zero-request, not legacy", () => {
    // An extension that explicitly opts into the sandbox with zero
    // requests is asking for a hollow bridge — still sandboxed, but
    // without any capability grants.
    const pkg = JSON.stringify({ trixty: {} });
    const parsed = parseManifestCapabilities(pkg);
    expect(parsed.legacy).toBe(false);
    expect(parsed.capabilities).toEqual([]);
  });

  it("treats malformed JSON as legacy so extension load surfaces the parse error", () => {
    const parsed = parseManifestCapabilities("{not-json");
    expect(parsed.legacy).toBe(true);
  });
});

describe("diffCapabilities", () => {
  it("returns all requested as pending when the extension has no previous record", () => {
    const diff = diffCapabilities(["fs:read", "ui:show-message"], undefined);
    expect(diff.pendingApproval).toEqual(["fs:read", "ui:show-message"]);
    expect(diff.alreadyGranted).toEqual([]);
    expect(diff.alreadyDenied).toEqual([]);
  });

  it("sorts capabilities into granted/denied/pending per previous decisions", () => {
    const diff = diffCapabilities(
      ["fs:read", "fs:write", "ui:show-message"],
      {
        requested: ["fs:read", "fs:write"],
        granted: ["fs:read"],
        denied: ["fs:write"],
        decidedAt: 0,
      },
    );
    expect(diff.alreadyGranted).toEqual(["fs:read"]);
    expect(diff.alreadyDenied).toEqual(["fs:write"]);
    expect(diff.pendingApproval).toEqual(["ui:show-message"]);
  });

  it("reports capabilities the extension used to request but no longer does", () => {
    const diff = diffCapabilities(["fs:read"], {
      requested: ["fs:read", "fs:write", "clipboard:write"],
      granted: ["fs:read", "fs:write"],
      denied: ["clipboard:write"],
      decidedAt: 0,
    });
    expect(diff.droppedByExtension.sort()).toEqual([
      "clipboard:write",
      "fs:write",
    ]);
  });
});

describe("persistDecision / loadAllGrants", () => {
  it("persists approvals and denials and loads them back intact", async () => {
    const next = await persistDecision({
      extensionId: "ext.a",
      requested: ["fs:read", "fs:write"],
      approved: ["fs:read"],
      denied: ["fs:write"],
      existingGrants: {},
    });
    expect(next["ext.a"].granted).toEqual(["fs:read"]);
    expect(next["ext.a"].denied).toEqual(["fs:write"]);

    const reloaded = await loadAllGrants();
    expect(reloaded["ext.a"].granted).toEqual(["fs:read"]);
    expect(reloaded["ext.a"].denied).toEqual(["fs:write"]);
  });

  it("merges a new decision with the existing record", async () => {
    const first = await persistDecision({
      extensionId: "ext.b",
      requested: ["fs:read"],
      approved: ["fs:read"],
      denied: [],
      existingGrants: {},
    });

    const second = await persistDecision({
      extensionId: "ext.b",
      requested: ["fs:read", "ui:show-message"],
      approved: ["ui:show-message"],
      denied: [],
      existingGrants: first,
    });

    // `fs:read` was already granted earlier; it should not drop off
    // just because the second decision didn't re-grant it.
    expect(second["ext.b"].granted.sort()).toEqual([
      "fs:read",
      "ui:show-message",
    ]);
  });

  it("trims grants to only what the current manifest requests", async () => {
    // An extension that previously requested `fs:write` and had it
    // approved, then shipped a new version that dropped the request,
    // should not keep carrying that grant — it would allow the next
    // manifest to silently re-enable it.
    const next = await persistDecision({
      extensionId: "ext.c",
      requested: ["fs:read"],
      approved: ["fs:read"],
      denied: [],
      existingGrants: {
        "ext.c": {
          requested: ["fs:read", "fs:write"],
          granted: ["fs:read", "fs:write"],
          denied: [],
          decidedAt: 0,
        },
      },
    });
    expect(next["ext.c"].granted).toEqual(["fs:read"]);
  });
});

describe("effectiveGrants", () => {
  it("returns an empty array for an unknown extension", () => {
    expect(effectiveGrants({}, "no.such.ext")).toEqual([]);
  });
});

describe("legacyCapabilitySet", () => {
  it("returns every known capability so legacy extensions see the full surface", () => {
    const set = legacyCapabilitySet();
    expect(set.sort()).toEqual([...KNOWN_CAPABILITIES].sort());
  });
});

describe("CAPABILITY_DESCRIPTIONS", () => {
  it("covers every known capability so the approval modal never renders an empty row", () => {
    for (const cap of KNOWN_CAPABILITIES) {
      expect(CAPABILITY_DESCRIPTIONS[cap]).toBeTruthy();
    }
  });
});
