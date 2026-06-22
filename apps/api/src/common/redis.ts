// =============================================================================
// SlopShield AI — Redis Connection Builder
// =============================================================================
// Pure helper that parses a REDIS_URL into a BullMQ/ioredis connection options
// object. Extracted from the BullModule factory so the URL-parsing and TLS
// decision can be exercised by property tests independently of the Nest
// bootstrap.
//
// TLS is enabled if and only if the URL uses the `rediss:` scheme, which is how
// Upstash Free requires the BullMQ Redis connection to connect.
// =============================================================================

/**
 * Connection options derived from a REDIS_URL, shaped for ioredis/BullMQ.
 */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  tls?: Record<string, never>; // {} enables TLS in ioredis/BullMQ
  maxRetriesPerRequest: null; // required by BullMQ workers
}

/**
 * Parse a REDIS_URL into connection options.
 *
 * - `host`     is the URL hostname.
 * - `port`     is the URL port, defaulting to `6379` when omitted.
 * - `password` is the URL password, omitted when absent.
 * - `tls`      is set to `{}` if and only if the scheme is `rediss:`.
 */
export function buildRedisConnection(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  const conn: RedisConnectionOptions = {
    host: url.hostname,
    port: parseInt(url.port, 10) || 6379, // default port
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
  if (url.protocol === "rediss:") {
    conn.tls = {}; // empty object => TLS enabled (SNI from host)
  }
  return conn;
}

/**
 * Minimal logger contract needed to report Redis connection errors. Both the
 * NestJS `Logger` and a test double satisfy this shape.
 */
export interface RedisErrorLogger {
  error(message: string): void;
}

/**
 * Minimal event-emitter contract for an ioredis client. Only the `on` method
 * for the `error` event is required here.
 */
export interface RedisErrorEmitter {
  on(event: "error", listener: (err: Error) => void): unknown;
}

/**
 * Build the descriptive Redis connection error message logged when the ioredis
 * client emits an `error` event (Requirement 12.3). The message guides the
 * operator toward the likely misconfiguration (host, port, TLS scheme,
 * credentials) and includes the underlying cause, without leaking REDIS_URL.
 */
export function formatRedisConnectionError(err: Error): string {
  return `Redis connection error. Verify REDIS_URL host, port, TLS scheme (rediss://) and credentials. Cause: ${err.message}`;
}

/**
 * Attach an `error` listener to an ioredis client that logs a descriptive
 * Redis connection error via the supplied logger (Requirement 12.3). Extracted
 * from the BullModule factory so the error-handling behavior is unit-testable
 * independently of the Nest bootstrap.
 */
export function attachRedisErrorLogger(
  client: RedisErrorEmitter,
  logger: RedisErrorLogger,
): void {
  client.on("error", (err: Error) => {
    logger.error(formatRedisConnectionError(err));
  });
}
