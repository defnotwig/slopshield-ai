// Feature: production-grade-system, Property 19: Secrets are redacted from all outbound content
import fc from "fast-check";
import { redactSecrets, REDACTED_TOKEN } from "./secret-redactor";
import { redactDeep, buildStructuredLog } from "../common/structured-log";

/**
 * Property 19: Secrets are redacted from all outbound content
 *
 * For any content containing detectable secrets, every outbound payload —
 * content sent to the AI provider (including fix-plan and Lark-summary
 * prompts), log output, and API responses — contains none of the original
 * secret values.
 *
 * Strategy: We generate secret-shaped strings matching the SecretRedactor's
 * patterns, embed them in various outbound content structures (plain strings
 * for AI prompts, nested objects for API responses, structured log entries),
 * and verify the raw secret value never appears in any output.
 *
 * **Validates: Requirements 6.5, 10.7**
 */

// --- character alphabets -------------------------------------------------

const UPPER_ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
const ALNUM =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
const B64URL =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".split(
    "",
  );
const APIKEY_VALUE_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-".split(
    "",
  );

/** Random fixed-or-ranged-length string over the given alphabet. */
function fixedLenString(
  alphabet: string[],
  minLength: number,
  maxLength: number = minLength,
): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...alphabet), { minLength, maxLength })
    .map((chars) => chars.join(""));
}

// --- secret generators ---------------------------------------------------

interface SecretCase {
  label: string;
  embedded: string;
  rawValue: string;
}

const awsKey: fc.Arbitrary<SecretCase> = fc
  .tuple(
    fc.constantFrom("AKIA", "ABIA", "ACCA", "ASIA"),
    fixedLenString(UPPER_ALNUM, 16),
  )
  .map(([prefix, body]) => {
    const secret = `${prefix}${body}`;
    return { label: "AWS Access Key", embedded: secret, rawValue: secret };
  });

const githubToken: fc.Arbitrary<SecretCase> = fc
  .tuple(
    fc.constantFrom("ghp", "gho", "ghu", "ghs", "ghr"),
    fixedLenString(ALNUM, 36, 40),
  )
  .map(([prefix, body]) => {
    const secret = `${prefix}_${body}`;
    return { label: "GitHub Token", embedded: secret, rawValue: secret };
  });

const stripeKey: fc.Arbitrary<SecretCase> = fc
  .tuple(
    fc.constantFrom("sk", "rk"),
    fc.constantFrom("live", "test"),
    fixedLenString(ALNUM, 24),
  )
  .map(([kind, env, body]) => {
    const secret = `${kind}_${env}_${body}`;
    return { label: "Stripe API Key", embedded: secret, rawValue: secret };
  });

const googleKey: fc.Arbitrary<SecretCase> = fixedLenString(B64URL, 35).map(
  (body) => {
    const secret = `AIza${body}`;
    return { label: "Google API Key", embedded: secret, rawValue: secret };
  },
);

const jwtToken: fc.Arbitrary<SecretCase> = fc
  .tuple(
    fixedLenString(B64URL, 10, 30),
    fixedLenString(B64URL, 10, 30),
    fixedLenString(B64URL, 10, 30),
  )
  .map(([h, p, s]) => {
    const secret = `eyJ${h}.eyJ${p}.${s}`;
    return { label: "JWT Token", embedded: secret, rawValue: secret };
  });

const genericPassword: fc.Arbitrary<SecretCase> = fc
  .tuple(
    fc.constantFrom("password", "passwd", "pwd", "secret"),
    fc.constantFrom("=", ":", " = ", ": "),
    fc.constantFrom('"', "'"),
    fc.stringOf(
      fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*".split(
          "",
        ),
      ),
      { minLength: 8, maxLength: 30 },
    ),
  )
  .map(([key, op, quote, value]) => ({
    label: "Generic Password",
    embedded: `${key}${op}${quote}${value}${quote}`,
    rawValue: value,
  }));

const apiKeyAssignment: fc.Arbitrary<SecretCase> = fc
  .tuple(
    fc.constantFrom("apiKey", "api_key", "api-key", "apikey", "api_secret"),
    fc.constantFrom("=", ":", " = ", ": "),
    fc.constantFrom('"', "'"),
    fixedLenString(APIKEY_VALUE_CHARS, 16, 40),
  )
  .map(([key, op, quote, value]) => ({
    label: "Generic API Key",
    embedded: `${key}${op}${quote}${value}${quote}`,
    rawValue: value,
  }));

const connectionString: fc.Arbitrary<SecretCase> = fc
  .tuple(
    fc.constantFrom("postgres", "mysql", "mongodb", "redis"),
    fixedLenString(ALNUM, 8, 20),
    fixedLenString(ALNUM, 8, 20),
    fixedLenString(ALNUM, 4, 10),
  )
  .map(([proto, user, pass, host]) => {
    const connValue = `${user}:${pass}@${host}:5432/db`;
    const embedded = `${proto}://${connValue}`;
    return {
      label: "Connection String",
      embedded,
      rawValue: connValue,
    };
  });

const privateKeyHeader: fc.Arbitrary<SecretCase> = fc
  .constantFrom(
    "-----BEGIN PRIVATE KEY-----",
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN EC PRIVATE KEY-----",
    "-----BEGIN DSA PRIVATE KEY-----",
  )
  .map((header) => ({
    label: "Private Key",
    embedded: header,
    rawValue: header,
  }));

const slackToken: fc.Arbitrary<SecretCase> = fc
  .tuple(
    fc.constantFrom("xoxb", "xoxp", "xoxa", "xoxo", "xoxs"),
    fixedLenString(ALNUM, 20, 40),
  )
  .map(([prefix, body]) => {
    const secret = `${prefix}-${body}`;
    return { label: "Slack Token", embedded: secret, rawValue: secret };
  });

const secretCase: fc.Arbitrary<SecretCase> = fc.oneof(
  awsKey,
  githubToken,
  stripeKey,
  googleKey,
  jwtToken,
  genericPassword,
  apiKeyAssignment,
  connectionString,
  privateKeyHeader,
  slackToken,
);

// --- surrounding text generators -----------------------------------------

const CODE_TOKENS = [
  "const",
  "let",
  "function",
  "return",
  "value",
  "config",
  "//",
  "data",
  "export",
  "import",
  "from",
  "the",
  "is",
  "set",
  "to",
  "env",
  "process",
  "load",
  "user",
];

const surroundingText: fc.Arbitrary<string> = fc
  .array(
    fc.tuple(
      fc.constantFrom(...CODE_TOKENS),
      fc.constantFrom(" ", "\n", "\t", "  "),
    ),
    { minLength: 0, maxLength: 8 },
  )
  .map((pairs) => pairs.map(([tok, sep]) => `${tok}${sep}`).join(""));

describe("Property 19: Secrets are redacted from all outbound content", () => {
  // -----------------------------------------------------------------------
  // 1. AI prompt content (plain string redaction via redactSecrets)
  // Simulates content sent to the AI provider (reviewCode, generateFixPlan,
  // summarizeForLark) — all call redactSecrets on untrusted content.
  // -----------------------------------------------------------------------
  it("redacts secrets from AI prompt content (plain string path)", () => {
    fc.assert(
      fc.property(
        surroundingText,
        secretCase,
        surroundingText,
        (before, sc, after) => {
          const content = `${before}${sc.embedded}${after}`;
          const redacted = redactSecrets(content);

          // Raw secret value must not appear in the outbound prompt
          expect(redacted).not.toContain(sc.rawValue);
          // Redaction token must be present confirming redaction occurred
          expect(redacted).toContain(REDACTED_TOKEN);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -----------------------------------------------------------------------
  // 2. Log output (nested object redaction via redactDeep + buildStructuredLog)
  // Simulates structured log entries that may contain secrets in nested fields.
  // -----------------------------------------------------------------------
  it("redacts secrets from structured log output (nested object path)", () => {
    fc.assert(
      fc.property(
        secretCase,
        surroundingText,
        fc.constantFrom("info", "warn", "error") as fc.Arbitrary<
          "info" | "warn" | "error"
        >,
        fc.constantFrom(
          "http.request",
          "request.error",
          "auth.login",
          "scan.create",
        ),
        (sc, context, level, event) => {
          // Build a structured log entry with the secret embedded in various fields
          const entry = {
            level,
            event,
            detail: `Error context: ${context}${sc.embedded}`,
            metadata: {
              body: `Request body had ${sc.embedded} inside`,
              nested: { deep: sc.embedded },
            },
          };

          const logOutput = buildStructuredLog(entry, () => new Date("2024-01-01T00:00:00Z"));

          // The raw secret value must never appear in the serialized log output
          expect(logOutput).not.toContain(sc.rawValue);
          // The redaction token must be present
          expect(logOutput).toContain(REDACTED_TOKEN);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -----------------------------------------------------------------------
  // 3. API response body (nested object redaction via redactDeep)
  // Simulates the HTTP exception filter applying redactDeep to response bodies
  // before they are sent to clients.
  // -----------------------------------------------------------------------
  it("redacts secrets from API response bodies (redactDeep path)", () => {
    fc.assert(
      fc.property(
        secretCase,
        surroundingText,
        fc.integer({ min: 400, max: 599 }),
        (sc, context, statusCode) => {
          // Simulate a response body that might accidentally contain a secret
          // (e.g. validation error echoing back user input containing a secret)
          const responseBody = {
            statusCode,
            message: `Validation failed: ${context}${sc.embedded}`,
            error: "BadRequest",
            details: {
              field: "sourceRef",
              received: sc.embedded,
            },
            timestamp: "2024-01-01T00:00:00.000Z",
            path: "/api/scans",
            requestId: "req-123",
          };

          const redacted = redactDeep(responseBody) as Record<string, unknown>;
          const serialized = JSON.stringify(redacted);

          // The raw secret value must not appear anywhere in the response
          expect(serialized).not.toContain(sc.rawValue);
          // The redaction token must be present confirming active redaction
          expect(serialized).toContain(REDACTED_TOKEN);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -----------------------------------------------------------------------
  // 4. Multiple secrets in one outbound payload
  // Verifies that when multiple secrets appear in one piece of content, ALL
  // are redacted — not just the first one.
  // -----------------------------------------------------------------------
  it("redacts ALL secrets when multiple appear in one outbound payload", () => {
    fc.assert(
      fc.property(
        secretCase,
        secretCase,
        surroundingText,
        (sc1, sc2, filler) => {
          const content = `config: ${sc1.embedded}\n${filler}token: ${sc2.embedded}`;

          // Test the direct redaction path (AI prompt content)
          const redacted = redactSecrets(content);
          expect(redacted).not.toContain(sc1.rawValue);
          expect(redacted).not.toContain(sc2.rawValue);

          // Test the nested object path (log/response content)
          const obj = { a: sc1.embedded, b: { c: sc2.embedded } };
          const deepRedacted = JSON.stringify(redactDeep(obj));
          expect(deepRedacted).not.toContain(sc1.rawValue);
          expect(deepRedacted).not.toContain(sc2.rawValue);
        },
      ),
      { numRuns: 100 },
    );
  });
});
