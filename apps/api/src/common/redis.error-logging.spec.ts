// =============================================================================
// SlopShield AI — Redis connection error logging unit tests
// =============================================================================
// Verifies Requirement 12.3: IF the connection to Upstash_Redis fails, THEN
// the API logs a descriptive Redis connection error.
//
// The error-handling behavior is extracted from the BullModule factory into
// attachRedisErrorLogger/formatRedisConnectionError so it can be exercised
// directly. These tests assert that an `error` event on the ioredis client
// triggers a descriptive Logger.error call.
// =============================================================================

import {
  attachRedisErrorLogger,
  formatRedisConnectionError,
  type RedisErrorEmitter,
  type RedisErrorLogger,
} from "./redis";

/**
 * Minimal fake ioredis client that records the `error` listener and can emit
 * an error to it, mirroring ioredis's EventEmitter contract.
 */
class FakeRedisClient implements RedisErrorEmitter {
  private listener?: (err: Error) => void;

  on(_event: "error", listener: (err: Error) => void): this {
    this.listener = listener;
    return this;
  }

  emitError(err: Error): void {
    this.listener?.(err);
  }
}

describe("attachRedisErrorLogger (Req 12.3)", () => {
  it("logs a descriptive Redis connection error when the client emits 'error'", () => {
    const client = new FakeRedisClient();
    const messages: string[] = [];
    const logger: RedisErrorLogger = {
      error: (message: string) => messages.push(message),
    };

    attachRedisErrorLogger(client, logger);

    const cause = new Error("ETIMEDOUT");
    client.emitError(cause);

    expect(messages).toHaveLength(1);
    const logged = messages[0];
    expect(logged).toContain("Redis connection error");
    expect(logged).toContain("REDIS_URL");
    expect(logged).toContain(cause.message);
  });

  it("does not log until an error event is emitted", () => {
    const client = new FakeRedisClient();
    const messages: string[] = [];
    attachRedisErrorLogger(client, {
      error: (m: string) => messages.push(m),
    });

    expect(messages).toHaveLength(0);
  });
});

describe("formatRedisConnectionError (Req 12.3)", () => {
  it("produces a descriptive message guiding the operator and including the cause", () => {
    const message = formatRedisConnectionError(
      new Error("connect ECONNREFUSED"),
    );

    expect(message).toContain("Redis connection error");
    expect(message).toContain("TLS scheme (rediss://)");
    expect(message).toContain("connect ECONNREFUSED");
  });
});
