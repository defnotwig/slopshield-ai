// =============================================================================
// SlopShield AI — Structured logging + redaction unit tests
// =============================================================================
// Verifies Req 10.7 (secrets redacted from log output) and Req 10.9 (structured
// logs) for the shared helpers used by the logging interceptor and exception
// filter.
// =============================================================================

import { REDACTED_TOKEN } from "../scan/secret-redactor";
import {
  redactDeep,
  buildStructuredLog,
} from "./structured-log";

describe("redactDeep (Req 10.7)", () => {
  it("redacts secret values inside nested strings", () => {
    const input = {
      message: 'apiKey="abcdef0123456789abcdef"',
      nested: { token: "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      list: ['password="supersecretvalue"'],
    };

    const out = redactDeep(input) as any;

    expect(out.message).toContain(REDACTED_TOKEN);
    expect(out.message).not.toContain("abcdef0123456789abcdef");
    expect(out.nested.token).toContain(REDACTED_TOKEN);
    expect(out.list[0]).toContain(REDACTED_TOKEN);
    expect(out.list[0]).not.toContain("supersecretvalue");
  });

  it("leaves non-string primitives unchanged", () => {
    expect(redactDeep(42)).toBe(42);
    expect(redactDeep(true)).toBe(true);
    expect(redactDeep(null)).toBeNull();
    expect(redactDeep(undefined)).toBeUndefined();
  });
});

describe("buildStructuredLog (Req 10.9)", () => {
  const fixedNow = () => new Date("2024-01-01T00:00:00.000Z");

  it("produces single-line parseable JSON with the structured fields", () => {
    const line = buildStructuredLog(
      {
        level: "info",
        event: "http.request",
        requestId: "req-1",
        method: "GET",
        path: "/api/health",
        statusCode: 200,
      },
      fixedNow,
    );

    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      level: "info",
      event: "http.request",
      requestId: "req-1",
      method: "GET",
      path: "/api/health",
      statusCode: 200,
      timestamp: "2024-01-01T00:00:00.000Z",
    });
  });

  it("redacts secret values present in log fields (Req 10.7)", () => {
    const line = buildStructuredLog(
      {
        level: "error",
        event: "request.error",
        detail: 'connect mongodb://user:supersecretpw@host/db failed',
      },
      fixedNow,
    );

    expect(line).toContain(REDACTED_TOKEN);
    expect(line).not.toContain("supersecretpw");
  });
});
