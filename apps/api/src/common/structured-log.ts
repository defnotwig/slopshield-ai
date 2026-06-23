/**
 * Structured logging + secret redaction helpers (Req 10.7, 10.9).
 *
 * Every log line the API emits for requests and security-relevant actions is a
 * single-line JSON object so log processors can parse fields directly instead
 * of scraping free-text (Req 10.9). Before serialization, all string values
 * are passed through {@link redactSecrets} so detected credentials never reach
 * log output (Req 10.7).
 *
 * These functions are pure string transforms with no NestJS dependencies,
 * which keeps them trivially unit-testable in isolation from the HTTP layer.
 */

import { redactSecrets } from "../scan/secret-redactor";

/** Severity levels emitted by the structured logger. */
export type StructuredLogLevel = "info" | "warn" | "error";

/**
 * A structured log entry. `event` names the thing that happened (e.g.
 * `http.request`, `request.error`); arbitrary additional context fields may be
 * attached and are redacted recursively.
 */
export interface StructuredLogEntry {
  level: StructuredLogLevel;
  event: string;
  [key: string]: unknown;
}

/**
 * Recursively walk a value, applying {@link redactSecrets} to every string it
 * contains. Objects and arrays are copied; primitives other than strings are
 * returned unchanged. This guarantees no detected secret value survives in any
 * nested field of a log entry or API response body (Req 10.7).
 */
export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDeep(val);
    }
    return out;
  }
  return value;
}

/**
 * Serialize a structured log entry to a single-line, secret-redacted JSON
 * string suitable for `Logger.log`/`warn`/`error`.
 *
 * @param entry  The structured fields to log.
 * @param now    Injectable clock for deterministic tests; defaults to the
 *               current time.
 */
export function buildStructuredLog(
  entry: StructuredLogEntry,
  now: () => Date = () => new Date(),
): string {
  const redacted = redactDeep(entry) as Record<string, unknown>;
  return JSON.stringify({
    timestamp: now().toISOString(),
    ...redacted,
  });
}
