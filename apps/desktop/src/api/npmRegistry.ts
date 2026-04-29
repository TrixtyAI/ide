"use client";

import { safeInvoke as invoke } from "@/api/tauri";
import { logger } from "@/lib/logger";

export interface NpmSearchHit {
  name: string;
  version: string;
  description: string;
  date?: string;
  /** raw publisher info (npm registry shape) */
  publisher?: { username?: string };
}

const SEARCH_URL = "https://registry.npmjs.org/-/v1/search";

/**
 * Hits the public npm registry search endpoint via the Rust cloud
 * proxy. The endpoint is fully unauthenticated and read-only — the
 * cloud_proxy host allow-list takes care of preventing the bridge from
 * turning into a generic SSRF gadget.
 *
 * Returns at most `size` results (the registry caps this around 250
 * but we use small page sizes for the typeahead).
 */
export async function searchNpm(
  query: string,
  size = 20,
): Promise<NpmSearchHit[]> {
  if (!query.trim()) return [];
  const url = `${SEARCH_URL}?text=${encodeURIComponent(query)}&size=${size}`;
  try {
    const result = await invoke(
      "cloud_proxy",
      { method: "GET", url, headers: [["Accept", "application/json"]] },
      { silent: true },
    );
    if (result.status < 200 || result.status >= 300) {
      logger.debug(`[npm] search HTTP ${result.status}`);
      return [];
    }
    const parsed = JSON.parse(result.body) as {
      objects?: { package: NpmSearchHit }[];
    };
    return (parsed.objects ?? []).map((o) => o.package);
  } catch (err) {
    logger.debug("[npm] search failed:", err);
    return [];
  }
}
