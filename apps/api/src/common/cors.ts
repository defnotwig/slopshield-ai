/**
 * CORS allowlist helpers (Req 10.5). `CORS_ORIGIN` may contain a single origin
 * or a comma-separated list of allowed origins. A cross-origin request is
 * permitted only when its `Origin` matches one of the configured entries.
 *
 * Kept free of NestJS dependencies so the matching logic can be unit tested
 * independently of the bootstrap.
 */

/** Parse `CORS_ORIGIN` into a trimmed, non-empty allowlist. */
export function parseCorsAllowlist(
  raw: string | undefined = process.env.CORS_ORIGIN,
): string[] {
  const value = raw ?? "http://localhost:3000";
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Build the `origin` callback for NestJS `enableCors`. Requests with no
 * `Origin` header (same-origin, curl, server-to-server) are allowed; requests
 * carrying an `Origin` are allowed only when it is in the allowlist, otherwise
 * the request is rejected (the browser receives no CORS headers).
 */
export function buildCorsOriginCallback(
  allowlist: string[] = parseCorsAllowlist(),
): (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => void {
  return (origin, callback) => {
    if (origin === undefined || allowlist.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin not allowed by CORS: ${origin}`), false);
  };
}
