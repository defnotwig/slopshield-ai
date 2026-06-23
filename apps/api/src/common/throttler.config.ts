/**
 * Rate-limiting configuration helpers for `@nestjs/throttler` (Req 10.2, 10.3,
 * B4). Kept free of NestJS decorators so the numeric resolution can be unit
 * tested independently of the module wiring.
 *
 * Three named throttlers are exposed:
 *  - `default` — a generous global ceiling applied to every route.
 *  - `login`   — a tight limit guarding `POST /auth/login` against credential
 *                stuffing / brute force.
 *  - `scan`    — a tight limit guarding `POST /scans` against scan-spam abuse.
 *
 * Each window/limit pair is overridable via environment variables so operators
 * can tune the limits without a code change. Values that are absent, blank, or
 * non-positive fall back to the documented defaults.
 */

export interface ThrottleRule {
  /** Time-to-live for the window, in milliseconds. */
  readonly ttl: number;
  /** Maximum number of requests permitted within the window. */
  readonly limit: number;
}

/** Named throttlers consumed by `ThrottlerModule.forRoot`. */
export const THROTTLER_NAMES = {
  default: "default",
  login: "login",
  scan: "scan",
} as const;

/** Documented fallback limits used when no env override is present. */
const DEFAULTS = {
  default: { ttl: 60_000, limit: 100 },
  login: { ttl: 60_000, limit: 5 },
  scan: { ttl: 60_000, limit: 10 },
} as const satisfies Record<keyof typeof THROTTLER_NAMES, ThrottleRule>;

/**
 * Parse a positive integer from an env value, returning `fallback` when the
 * value is absent, blank, non-numeric, or not strictly positive.
 */
function positiveIntOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Resolve the global default rate-limit rule. */
export function resolveDefaultThrottle(
  env: NodeJS.ProcessEnv = process.env,
): ThrottleRule {
  return {
    ttl: positiveIntOr(env.RATE_LIMIT_TTL_MS, DEFAULTS.default.ttl),
    limit: positiveIntOr(env.RATE_LIMIT_DEFAULT, DEFAULTS.default.limit),
  };
}

/** Resolve the tight `POST /auth/login` rate-limit rule. */
export function resolveLoginThrottle(
  env: NodeJS.ProcessEnv = process.env,
): ThrottleRule {
  return {
    ttl: positiveIntOr(env.RATE_LIMIT_LOGIN_TTL_MS, DEFAULTS.login.ttl),
    limit: positiveIntOr(env.RATE_LIMIT_LOGIN, DEFAULTS.login.limit),
  };
}

/** Resolve the tight `POST /scans` rate-limit rule. */
export function resolveScanThrottle(
  env: NodeJS.ProcessEnv = process.env,
): ThrottleRule {
  return {
    ttl: positiveIntOr(env.RATE_LIMIT_SCAN_TTL_MS, DEFAULTS.scan.ttl),
    limit: positiveIntOr(env.RATE_LIMIT_SCAN, DEFAULTS.scan.limit),
  };
}

/**
 * Build the throttler array consumed by `ThrottlerModule.forRoot`.
 *
 * Only the global `default` throttler is registered here. With
 * `@nestjs/throttler`, every throttler listed in `forRoot` is enforced on every
 * route, so the tighter `login`/`scan` limits are NOT registered globally
 * (that would throttle all routes to the tightest limit). Instead they are
 * applied per-route by overriding the `default` throttler via the `@Throttle`
 * decorator using {@link resolveLoginThrottle} / {@link resolveScanThrottle}.
 */
export function buildThrottlerOptions(
  env: NodeJS.ProcessEnv = process.env,
): Array<{ name: string } & ThrottleRule> {
  return [{ name: THROTTLER_NAMES.default, ...resolveDefaultThrottle(env) }];
}
