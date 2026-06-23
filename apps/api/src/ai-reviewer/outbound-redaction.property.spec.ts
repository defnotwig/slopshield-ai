// Feature: production-grade-system, Property 19: Secrets are redacted from all outbound content
//
// Property 19: Secrets are redacted from all outbound content.
// Validates: Requirements 6.5, 10.7
//
// For any content containing detectable secrets, every outbound payload sent to
// the AI provider — across ALL three outbound channels (code review,
// generateFixPlan, summarizeForLark) — contains none of the original secret
// values.
//
// Strategy: we drive the REAL `GeminiProvider` (the component that owns the
// outbound prompts) and intercept the AI SDK boundary by mocking
// `@google/genai`. The mock captures the exact `contents` string the provider
// hands to `generateContent` — i.e. the real outbound payload assembled by the
// production code paths after redaction. fast-check generates realistic secret
// values (matching the redactor's patterns), embeds them into the inputs of
// each channel, runs the channel, and asserts the captured outbound payload
// never contains the raw secret value.

import { Finding } from "@slopshield/shared";
import fc from "fast-check";

// --- AI SDK boundary interception ---------------------------------------
// Capture every `contents` payload the provider sends outbound. The mock lives
// at the SDK boundary, so everything the provider builds (after redaction) is
// observed exactly as it would leave the process.
const capturedPayloads: string[] = [];

jest.mock("@google/genai", () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest.fn(async ({ contents }: { contents: unknown }) => {
        capturedPayloads.push(
          typeof contents === "string" ? contents : JSON.stringify(contents),
        );
        // A schema-valid AIReviewResult JSON also satisfies the (unvalidated)
        // fix-plan JSON.parse and the summary text path, so one canned response
        // works for all three channels.
        return {
          text: JSON.stringify({
            summary: "ok",
            findings: [],
            recommended_tests: [],
            refactor_plan: [],
          }),
        };
      }),
    },
  })),
}));

// Imported AFTER jest.mock so the provider picks up the mocked SDK.
import { GeminiProvider } from "./providers/gemini.provider";

/** Minimal ConfigService stub that supplies a Gemini API key. */
const configServiceStub = {
  get: (key: string, defaultValue?: string) => {
    if (key === "GEMINI_API_KEY") return "test-gemini-key";
    if (key === "GEMINI_MODEL") return defaultValue ?? "gemini-2.5-pro";
    return defaultValue;
  },
} as any;

// --- secret generators (match the redactor's patterns) ------------------

const UPPER_ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
const ALNUM =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
const B64URL =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".split("");
const APIKEY_VALUE_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-".split("");

function fixedLenString(
  alphabet: string[],
  minLength: number,
  maxLength: number = minLength,
): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...alphabet), { minLength, maxLength })
    .map((chars) => chars.join(""));
}

interface SecretCase {
  /** Snippet embedded into the channel input. */
  embedded: string;
  /** Sensitive substring that MUST NOT appear in any outbound payload. */
  rawValue: string;
}

const awsKey: fc.Arbitrary<SecretCase> = fc
  .tuple(
    fc.constantFrom("AKIA", "ABIA", "ACCA", "ASIA"),
    fixedLenString(UPPER_ALNUM, 16),
  )
  .map(([prefix, body]) => {
    const secret = `${prefix}${body}`;
    return { embedded: secret, rawValue: secret };
  });

const githubToken: fc.Arbitrary<SecretCase> = fc
  .tuple(
    fc.constantFrom("ghp", "gho", "ghu", "ghs", "ghr"),
    fixedLenString(ALNUM, 36, 40),
  )
  .map(([prefix, body]) => {
    const secret = `${prefix}_${body}`;
    return { embedded: secret, rawValue: secret };
  });

const stripeKey: fc.Arbitrary<SecretCase> = fc
  .tuple(
    fc.constantFrom("sk", "rk"),
    fc.constantFrom("live", "test"),
    fixedLenString(ALNUM, 24),
  )
  .map(([kind, env, body]) => {
    const secret = `${kind}_${env}_${body}`;
    return { embedded: secret, rawValue: secret };
  });

const googleKey: fc.Arbitrary<SecretCase> = fixedLenString(B64URL, 35).map(
  (body) => {
    const secret = `AIza${body}`;
    return { embedded: secret, rawValue: secret };
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
    return { embedded: secret, rawValue: secret };
  });

const apiKeyAssignment: fc.Arbitrary<SecretCase> = fc
  .tuple(
    fc.constantFrom("apiKey", "api_key", "api-key", "apikey", "api_secret"),
    fc.constantFrom("=", ":", " = ", ": "),
    fc.constantFrom('"', "'"),
    fixedLenString(APIKEY_VALUE_CHARS, 16, 40),
  )
  .map(([key, op, quote, value]) => ({
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
  .map((header) => ({ embedded: header, rawValue: header }));

const secretCase: fc.Arbitrary<SecretCase> = fc.oneof(
  awsKey,
  githubToken,
  stripeKey,
  googleKey,
  jwtToken,
  apiKeyAssignment,
  privateKeyHeader,
);

function makeFinding(secretSnippet: string): Finding {
  return {
    id: "f1",
    scanId: "scan-1",
    severity: "high",
    category: "backend-security",
    title: `Hardcoded credential ${secretSnippet}`,
    file: "src/config.ts",
    line: 12,
    standardReferences: ["CWE-798"],
    whyItMatters: `A secret like ${secretSnippet} was committed.`,
    recommendation: `Remove ${secretSnippet} and rotate it.`,
    blocking: true,
    confidence: 0.9,
    source: "secret-scanner",
  };
}

describe("GeminiProvider — Property 19: secrets are redacted from all outbound content", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    capturedPayloads.length = 0;
    provider = new GeminiProvider(configServiceStub);
  });

  it("never leaks a raw secret value across reviewCode, generateFixPlan, or summarizeForLark", async () => {
    await fc.assert(
      fc.asyncProperty(secretCase, async (sc) => {
        capturedPayloads.length = 0;

        // Channel 1: code review — secret embedded in file content.
        await provider.reviewCode({
          scanId: "scan-1",
          files: [
            {
              path: "src/config.ts",
              content: `const config = { token: "${sc.embedded}" };`,
              language: "typescript",
              isFrontend: false,
              isBackend: true,
            },
          ],
          existingFindings: [],
        });

        // Channel 2: fix plan — secret embedded in findings text AND code context.
        await provider.generateFixPlan(
          [makeFinding(sc.embedded)],
          `// leaked code\nconst apiKey = "${sc.embedded}";`,
        );

        // Channel 3: Lark summary — secret embedded in the report object.
        await provider.summarizeForLark({
          overallScore: 42,
          statusResult: "blocked",
          totalFindings: 1,
          leakedNote: `found ${sc.embedded} in source`,
        });

        // All three channels must have produced an outbound payload.
        expect(capturedPayloads.length).toBe(3);

        // No outbound payload may contain the raw secret value.
        for (const payload of capturedPayloads) {
          expect(payload.includes(sc.rawValue)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
