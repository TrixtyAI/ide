"use client";

import { safeInvoke as invoke } from "@/api/tauri";
import { logger } from "@/lib/logger";

/**
 * Cloud-AI provider IDs whose API keys live in the OS keychain. Mirror
 * of the Rust `SECRET_ALLOWED_PROVIDERS` allow-list — keep both in sync
 * if you add a provider.
 */
export type SecretProvider = "openai" | "anthropic" | "gemini" | "openrouter";

/**
 * Stash an API key in the OS keychain. Overwrites any previous value
 * silently. Empty strings clear the entry, mirroring the way the old
 * `aiSettings.providerKeys` field treated `""` as "no key".
 */
export async function setProviderSecret(
  provider: SecretProvider,
  secret: string,
): Promise<void> {
  if (!secret) {
    await clearProviderSecret(provider);
    return;
  }
  await invoke("set_provider_secret", { provider, secret });
}

/**
 * Retrieve a provider's stored secret. Returns `""` for both
 * "never set" and "explicitly empty" so callers can use a single
 * truthy check (`if (key) ...`) the same way the old plaintext
 * settings field worked.
 */
export async function getProviderSecret(
  provider: SecretProvider,
): Promise<string> {
  try {
    const secret = await invoke("get_provider_secret", { provider });
    return secret ?? "";
  } catch (err) {
    logger.warn(`[providerSecrets] read failed for ${provider}:`, err);
    return "";
  }
}

/**
 * Probe whether a provider has any stored secret. Cheaper than
 * `getProviderSecret` on Linux (libsecret returns the value either way,
 * but on macOS this can avoid a Touch-ID prompt) and good enough for
 * the "Configured" pill in the Settings UI.
 */
export async function hasProviderSecret(
  provider: SecretProvider,
): Promise<boolean> {
  try {
    return await invoke("has_provider_secret", { provider });
  } catch (err) {
    logger.warn(`[providerSecrets] probe failed for ${provider}:`, err);
    return false;
  }
}

export async function clearProviderSecret(
  provider: SecretProvider,
): Promise<void> {
  try {
    await invoke("clear_provider_secret", { provider });
  } catch (err) {
    logger.warn(`[providerSecrets] clear failed for ${provider}:`, err);
  }
}

export const SECRET_PROVIDERS: SecretProvider[] = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
];
