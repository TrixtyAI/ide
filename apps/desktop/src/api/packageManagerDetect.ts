"use client";

import { safeInvoke as invoke } from "@/api/tauri";
import { logger } from "@/lib/logger";

export type PackageManagerId = "pnpm" | "bun" | "yarn" | "npm";

export interface PackageManagerInfo {
  id: PackageManagerId;
  /** True when a lock file pointing at this PM exists at the workspace root. */
  detectedFromLockfile: boolean;
  /** True when the PM binary is callable (`<pm> --version` returns 0). */
  available: boolean;
}

/**
 * Walk the workspace root looking for a lock file that pins a specific
 * package manager. Order is the de-facto Node ecosystem precedence:
 * pnpm → bun → yarn → npm. If two lockfiles co-exist the earlier match
 * wins (matches what most CI runners do).
 */
async function detectFromLockfile(
  rootPath: string,
): Promise<PackageManagerId | null> {
  try {
    const entries = await invoke("read_directory", { path: rootPath });
    const names = new Set(entries.map((e) => e.name));
    if (names.has("pnpm-lock.yaml")) return "pnpm";
    if (names.has("bun.lockb") || names.has("bun.lock")) return "bun";
    if (names.has("yarn.lock")) return "yarn";
    if (names.has("package-lock.json")) return "npm";
  } catch (err) {
    logger.debug("[packageManagerDetect] read_directory failed:", err);
  }
  return null;
}

/**
 * Probe each PM's `--version` flag concurrently. We call through
 * `execute_command` because the Tauri runtime already enforces the
 * shell sandbox there, and we don't need any more permissions than
 * those for a one-shot version check.
 */
async function detectAvailableBinaries(): Promise<Set<PackageManagerId>> {
  const pms: PackageManagerId[] = ["pnpm", "bun", "yarn", "npm"];
  const results = await Promise.all(
    pms.map(async (id) => {
      try {
        await invoke(
          "execute_command",
          { command: id, args: ["--version"], cwd: null },
          { silent: true },
        );
        return id;
      } catch {
        return null;
      }
    }),
  );
  return new Set(results.filter((x): x is PackageManagerId => x !== null));
}

/** Combined detection: prefer the lockfile-pinned PM, otherwise the
 *  first available binary in the same precedence order. */
export async function detectPackageManager(
  rootPath: string | null,
): Promise<PackageManagerInfo[]> {
  const available = await detectAvailableBinaries();
  const lockfilePm = rootPath ? await detectFromLockfile(rootPath) : null;
  const order: PackageManagerId[] = ["pnpm", "bun", "yarn", "npm"];
  return order.map((id) => ({
    id,
    detectedFromLockfile: lockfilePm === id,
    available: available.has(id),
  }));
}

/** Return the install verb for the given package manager. `npm` and
 *  `yarn` use `add` for new dep registration; `pnpm` and `bun` agree on
 *  `add` as well. `npm` historically uses `install`, but `npm install
 *  <pkg>` and `npm add <pkg>` are equivalent in modern npm — `add`
 *  reads cleaner in tooling output. */
export function installVerb(): "add" {
  return "add";
}
