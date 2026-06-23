// =============================================================================
// SlopShield AI — Global exception filter unit tests
// =============================================================================
// Verifies Req 10.8 (safe error responses — no stack traces / internals) and
// Req 10.7 (secrets redacted from responses) for HttpExceptionFilter.
// =============================================================================

import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
} from "@nestjs/common";

import { HttpExceptionFilter } from "./http-exception.filter";
import { REDACTED_TOKEN } from "../../scan/secret-redactor";

interface CapturedResponse {
  statusCode: number;
  body: any;
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
    json(body: any) {
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

describe("HttpExceptionFilter (Req 10.7, 10.8)", () => {
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

  it("returns a generic 500 without stack trace or internal message for unexpected errors (Req 10.8)", () => {
    const captured: CapturedResponse = { statusCode: 0, body: undefined };
    const host = makeHost(
      { url: "/api/scans", method: "POST", requestId: "req-9" },
      captured,
    );

    const secretInternal = new Error(
      "DB failed at C:/app/secret-path/internal.ts apiKey=\"abcdef0123456789abcdef\"",
    );
    secretInternal.stack = "Error: DB failed\n  at internalFn (/srv/app/db.ts:42)";

    filter.catch(secretInternal, host);

    expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    const serialized = JSON.stringify(captured.body);
    expect(captured.body.message).toBe("Internal server error");
    expect(captured.body.error).toBe("InternalServerError");
    // No stack, no internal path, no leaked secret in the client response.
    expect(serialized).not.toContain("internal.ts");
    expect(serialized).not.toContain("/srv/app/db.ts");
    expect(serialized).not.toContain("abcdef0123456789abcdef");
    expect(serialized).not.toContain("stack");
  });

  it("surfaces HttpException messages but redacts secrets in them (Req 10.7)", () => {
    const captured: CapturedResponse = { statusCode: 0, body: undefined };
    const host = makeHost(
      { url: "/api/login", method: "POST", requestId: "req-3" },
      captured,
    );

    const exception = new BadRequestException({
      message: 'Invalid value apiKey="abcdef0123456789abcdef"',
      error: "BadRequest",
    });

    filter.catch(exception, host);

    expect(captured.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body.error).toBe("BadRequest");
    expect(captured.body.message).toContain(REDACTED_TOKEN);
    expect(JSON.stringify(captured.body)).not.toContain(
      "abcdef0123456789abcdef",
    );
  });

  it("includes correlation fields in the response body (Req 10.9 traceability)", () => {
    const captured: CapturedResponse = { statusCode: 0, body: undefined };
    const host = makeHost(
      { url: "/api/scans", method: "GET", requestId: "req-trace" },
      captured,
    );

    filter.catch(new BadRequestException("nope"), host);

    expect(captured.body.requestId).toBe("req-trace");
    expect(captured.body.path).toBe("/api/scans");
    expect(typeof captured.body.timestamp).toBe("string");
  });
});
