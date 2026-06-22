/**
 * Pure environment helpers for port resolution, required-env validation, and
 * heavy-analyzer file capping. Kept free of NestJS dependencies so the logic
 * can be exercised by property tests independently of the bootstrap.
 */

/**
 * Resolve the port the API should listen on.
 *
 * Precedence: `PORT` (when a valid positive integer) → `API_PORT` (when valid)
 * → `3001`.
 */
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  // Evaluate PORT and API_PORT independently: return the first that parses to
  // a valid positive integer, so an invalid PORT (e.g. "0", "", "notaport")
  // falls back to a valid API_PORT rather than the 3001 default.
  const parsePort = (raw: string | undefined): number | undefined => {
    if (raw === undefined) return undefined;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  return parsePort(env.PORT) ?? parsePort(env.API_PORT) ?? 3001; // default
}

const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "CORS_ORIGIN",
] as const;

/**
 * In production, return the required variables that are absent or blank.
 * Returns an empty list outside production.
 */
export function findMissingEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  return REQUIRED_IN_PRODUCTION.filter((k) => !env[k] || env[k]!.trim() === "");
}

/**
 * Bound the number of files sent to memory/CPU-heavy analyzers.
 *
 * Returns at most `max` elements as an order-preserving prefix of `files`.
 * A negative `max` returns all files unchanged.
 */
export function capFiles<T>(files: T[], max: number): T[] {
  return max >= 0 ? files.slice(0, max) : files;
}

/**
 * Configurable heavy-analyzer file cap, read from `MAX_ANALYZE_FILES`
 * (default `50`).
 */
export const maxAnalyzeFiles = (): number =>
  Number(process.env.MAX_ANALYZE_FILES ?? 50);
