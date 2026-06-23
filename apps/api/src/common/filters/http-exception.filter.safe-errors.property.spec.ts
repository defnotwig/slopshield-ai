// =============================================================================
// Feature: production-grade-system, Property 31: Unexpected errors produce safe responses
//
// Validates: Requirements 10.8
//
// For any unexpected error thrown while handling a request, the API response
// body excludes stack traces and internal implementation details. This test
// generates arbitrary error messages containing sensitive data (file paths,
// stack traces, internal class names, connection strings, environment details)
// and asserts that the global exception filter never leaks them to the client.
// =============================================================================

import fc from "fast-check";
import { ArgumentsHost, HttpStatus } from "@nestjs/common";

import { HttpExceptionFilter } from "./http-exception.filter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CapturedResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

/** Build a fake ArgumentsHost wrapping a minimal request/response pair. */
function makeHost(
  request: Record<string, unknown>,
  captured: CapturedResponse,
): ArgumentsHost {
  const response = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return this;
    },
  };
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
}

// Arbitraries for generating realistic internal error content
// that should never reach the client.

/** Generates realistic file-path fragments. */
const arbFilePath = fc.oneof(
  fc.constantFrom(
    "/srv/app/src/auth/auth.service.ts:42",
    "C:\\Users\\dev\\project\\src\\scan\\scan.processor.ts:108",
    "/home/node/app/dist/common/filters/http-exception.filter.js:31",
    "/var/task/node_modules/@nestjs/core/router/router-exception-filters.js:16",
    "at Object.<anonymous> (/app/src/index.ts:5:10)",
    "/opt/render/project/src/apps/api/src/scan/scan.service.ts",
    "apps/api/src/common/env.ts",
    "C:/Users/Ludwig Rivera/.gemini/antigravity/scratch/slopshield-ai/apps/api/src/main.ts",
  ),
  fc.tuple(
    fc.constantFrom("/srv/", "/home/", "C:\\Users\\", "/opt/", "/var/"),
    fc.stringOf(fc.constantFrom("a", "b", "src", "/", "\\", ".ts", ".js"), {
      minLength: 5,
      maxLength: 40,
    }),
    fc.constantFrom(":10", ":42", ":108", ""),
  ).map(([prefix, body, line]) => `${prefix}${body}${line}`),
);

/** Generates realistic stack-trace strings. */
const arbStackTrace = fc
  .tuple(
    fc.constantFrom("Error", "TypeError", "RangeError", "DatabaseError"),
    fc.string({ minLength: 5, maxLength: 60 }),
    fc.array(arbFilePath, { minLength: 1, maxLength: 5 }),
  )
  .map(([name, msg, paths]) => {
    const frames = paths.map((p) => `    at someFunction (${p})`).join("\n");
    return `${name}: ${msg}\n${frames}`;
  });

/** Generates internal detail messages that should never leak. */
const arbInternalMessage = fc.oneof(
  fc.constantFrom(
    "Cannot read properties of undefined (reading 'userId')",
    "ECONNREFUSED 127.0.0.1:5432",
    "PrismaClientKnownRequestError: Invalid `prisma.user.findUnique()` invocation",
    "connect ECONNREFUSED postgres://user:pass@db:5432/mydb",
    "FATAL: password authentication failed for user \"admin\"",
    'QueryFailedError: relation "audit_logs" does not exist',
    "Redis connection to redis://default:secret@redis-host:6379 failed",
    "JWT malformed: unexpected token at position 5",
    "Error: ENOMEM: not enough memory, cannot allocate 2GB",
  ),
  fc.string({ minLength: 10, maxLength: 200 }),
);

/** Generates errors with sensitive internal data. */
const arbUnexpectedError = fc
  .tuple(arbInternalMessage, arbStackTrace)
  .map(([message, stack]) => {
    const err = new Error(message);
    err.stack = stack;
    return err;
  });

/** Also test non-Error throwables (strings, objects, etc.) */
const arbNonErrorThrowable = fc.oneof(
  fc.string({ minLength: 5, maxLength: 100 }),
  fc.record({
    code: fc.string({ minLength: 3, maxLength: 20 }),
    detail: fc.string({ minLength: 5, maxLength: 100 }),
    path: arbFilePath,
  }),
);

/** Any kind of thrown value */
const arbThrown = fc.oneof(
  arbUnexpectedError as fc.Arbitrary<unknown>,
  arbNonErrorThrowable,
);

// Patterns that must never appear in client-facing response bodies
const UNSAFE_PATTERNS = [
  // Stack trace indicators
  /\bat\s+\S+\s+\(/i, // "at functionName ("
  /\bat\s+Object\.<anonymous>/i,
  /\bat\s+Module\./i,
  /\bat\s+internal\//i,
  /^\s+at\s+/m, // indented "at " lines

  // File paths (Unix and Windows)
  /\/srv\//,
  /\/home\//,
  /\/opt\//,
  /\/var\/task\//,
  /\/app\//,
  /C:\\Users\\/i,
  /C:\/Users\//i,

  // Node internals
  /node_modules/,
  /\.ts:\d+/,
  /\.js:\d+/,

  // Common error class names that reveal internals
  /PrismaClient/,
  /QueryFailedError/,
  /ECONNREFUSED/,
  /ENOMEM/,
];

// ---------------------------------------------------------------------------
// Property Test
// ---------------------------------------------------------------------------

describe("HttpExceptionFilter — Property 31: Unexpected errors produce safe responses", () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    // Silence logger output during tests.
    jest
      .spyOn((filter as any).logger, "error")
      .mockImplementation(() => undefined);
    jest
      .spyOn((filter as any).logger, "warn")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("never leaks stack traces or internal details for any unexpected error (≥100 iterations)", () => {
    fc.assert(
      fc.property(arbThrown, (thrown) => {
        const captured: CapturedResponse = {
          statusCode: 0,
          body: {} as Record<string, unknown>,
        };
        const host = makeHost(
          { url: "/api/test", method: "POST", requestId: "pbt-req" },
          captured,
        );

        filter.catch(thrown, host);

        // Must return 500 for unexpected errors
        expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);

        // Serialize the entire response body to check for leaks
        const serialized = JSON.stringify(captured.body);

        // The message must be the generic one
        expect(captured.body.message).toBe("Internal server error");
        expect(captured.body.error).toBe("InternalServerError");

        // Must not contain any unsafe patterns
        for (const pattern of UNSAFE_PATTERNS) {
          expect(serialized).not.toMatch(pattern);
        }

        // Must not contain "stack" as a key in the response
        expect(captured.body).not.toHaveProperty("stack");

        // If the thrown value was an Error, its message must not appear verbatim
        if (thrown instanceof Error && thrown.message.length > 20) {
          expect(serialized).not.toContain(thrown.message);
        }

        // The stack from the original error must never appear
        if (thrown instanceof Error && thrown.stack) {
          expect(serialized).not.toContain(thrown.stack);
        }
      }),
      { numRuns: 150 },
    );
  });
});
