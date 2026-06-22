// Feature: github-repository-scanner, Property 12
import fc from "fast-check";
import { redactSecrets, REDACTED_TOKEN } from "./secret-redactor";

/**
 * Property 12: Secret redaction before AI review
 *
 * For any file content containing a value matching the known secret patterns,
 * the output of `redactSecrets` contains none of the raw secret values (each is
 * replaced by the redaction token), so untrusted external repository content
 * cannot leak credentials to the AI provider.
 *
 * Strategy: fast-check generates realistic secrets that match the redactor's
 * patterns (AWS access key, GitHub token, Stripe key, Google API key, JWT,
 * generic `apiKey="..."`, and a PEM private-key header). Each secret is embedded
 * into random surrounding code-like text, and we assert that:
 *   1. the raw secret value no longer appears in the redacted output, and
 *   2. the redaction token does appear.
 *
 * Surrounding text is drawn from a fixed pool of short (<= 9 char) code tokens
 * joined by whitespace. Every generated secret value is a contiguous run of
 * >= 16 non-whitespace characters (or, for the PEM header, a phrase absent from
 * the pool), so surrounding text can never accidentally reproduce a raw secret
 * and trigger a false failure.
 *
 * Validates: Requirements 10.1
 */

// --- character alphabets -------------------------------------------------

const UPPER_ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
const ALNUM =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
const B64URL =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".split("");
const APIKEY_VALUE_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-".split("");

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

/**
 * A generated secret to embed: `embedded` is the snippet inserted into the
 * surrounding text; `rawValue` is the sensitive substring that MUST NOT appear
 * in the redacted output.
 */
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

const secretCase: fc.Arbitrary<SecretCase> = fc.oneof(
  awsKey,
  githubToken,
  stripeKey,
  googleKey,
  jwtToken,
  apiKeyAssignment,
  privateKeyHeader,
);

// --- surrounding text ----------------------------------------------------

// Short code-like tokens (all <= 9 chars, none reproduce a secret value).
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
  "key",
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
    { minLength: 0, maxLength: 12 },
  )
  .map((pairs) => pairs.map(([tok, sep]) => `${tok}${sep}`).join(""));

describe("redactSecrets — Property 12: secret redaction before AI review", () => {
  it("never leaks a raw secret value and always inserts the redaction token", () => {
    fc.assert(
      fc.property(
        surroundingText,
        secretCase,
        surroundingText,
        (before, sc, after) => {
          const content = `${before}${sc.embedded}${after}`;
          const output = redactSecrets(content);

          // 1. The raw secret value must not survive redaction.
          expect(output.includes(sc.rawValue)).toBe(false);
          // 2. The redaction token must be present.
          expect(output.includes(REDACTED_TOKEN)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
