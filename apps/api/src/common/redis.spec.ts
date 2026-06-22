// Feature: backend-hosting-live-mode, Property 2
//
// Property 2: Redis URL → connection derivation and TLS decision.
// Validates: Requirements 5.1, 5.2, 5.3, 5.4
//
// For any well-formed REDIS_URL, buildRedisConnection(url) derives:
//   - host     from the URL hostname,
//   - password from the URL password (omitted when absent),
//   - port     from the URL port, defaulting to 6379 when omitted,
// AND sets `tls` to an object IF AND ONLY IF the scheme is `rediss:`
// (no `tls` for `redis:`).

import fc from "fast-check";
import { buildRedisConnection } from "./redis";

describe("buildRedisConnection — Property 2: Redis URL → connection derivation and TLS decision", () => {
  // Smart generators constrained to the valid REDIS_URL input space.

  // DNS-style hostnames: one or more labels of [a-z0-9-] joined by dots.
  const hostArb = fc
    .array(
      fc
        .stringMatching(/^[a-z0-9](?:[a-z0-9-]{0,20}[a-z0-9])?$/)
        .filter((s) => s.length > 0),
      { minLength: 1, maxLength: 4 },
    )
    .map((labels) => labels.join("."));

  const schemeArb = fc.constantFrom("redis", "rediss");

  // Optional explicit port in the valid TCP range.
  const portArb = fc.option(fc.integer({ min: 1, max: 65535 }), {
    nil: undefined,
  });

  // Optional password using URL-safe characters (no reserved chars that would
  // need percent-encoding), so the generated URL stays well-formed.
  const passwordArb = fc.option(
    fc.stringMatching(/^[A-Za-z0-9._~-]{1,24}$/).filter((s) => s.length > 0),
    { nil: undefined },
  );

  it("derives host/port/password and enables TLS iff scheme is rediss:", () => {
    fc.assert(
      fc.property(
        schemeArb,
        hostArb,
        portArb,
        passwordArb,
        (scheme, host, port, password) => {
          const auth = password !== undefined ? `:${password}@` : "";
          const portPart = port !== undefined ? `:${port}` : "";
          const url = `${scheme}://${auth}${host}${portPart}`;

          const conn = buildRedisConnection(url);

          // Host is derived from the URL hostname.
          expect(conn.host).toBe(host);

          // Port defaults to 6379 when omitted, else the explicit port.
          expect(conn.port).toBe(port ?? 6379);

          // Password is present iff provided, and omitted otherwise.
          if (password !== undefined) {
            expect(conn.password).toBe(password);
          } else {
            expect(conn.password).toBeUndefined();
          }

          // BullMQ workers require maxRetriesPerRequest === null.
          expect(conn.maxRetriesPerRequest).toBeNull();

          // TLS is set to an object iff the scheme is rediss:.
          if (scheme === "rediss") {
            expect(conn.tls).toEqual({});
          } else {
            expect(conn.tls).toBeUndefined();
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
