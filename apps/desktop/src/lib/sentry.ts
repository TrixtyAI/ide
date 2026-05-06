import * as Sentry from "@sentry/react";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * Enhanced invoke that propagates Sentry tracing context to the Rust backend.
 */
export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const span = Sentry.getActiveSpan();
  let traceContext = {};

  if (span) {
    // Extract tracing context using v8 API
    traceContext = (Sentry as any).getTraceData?.() || {};
  }

  return await tauriInvoke<T>(cmd, {
    ...args,
    _sentry_context: traceContext,
  });
}

/**
 * Initialize OpenTelemetry for Sentry if needed (Sentry Next.js SDK usually handles this)
 */
export function initTelemetry() {
  // Add custom OTel instrumentation here if needed
}
