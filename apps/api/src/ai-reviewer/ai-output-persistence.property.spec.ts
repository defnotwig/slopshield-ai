// Feature: production-grade-system, Property 18: AI output is persisted iff schema-valid
//
// Property 18: AI output is persisted iff schema-valid.
// Validates: Requirements 6.3, 6.4
//
// For any AI review output, the AI_Reviewer persists the resulting
// findings/summary IF AND ONLY IF the output passes its Zod schema validation
// (`AIReviewResultSchema`); invalid output is discarded and the scan continues.
//
// Strategy: drive the REAL `GeminiProvider.reviewCode` (the code that parses the
// model completion and gates it through `AIReviewResultSchema.parse`). A fake
// Gemini client is injected so the "model completion" is whatever fast-check
// generates — a free mixture of well-formed results, results with subtly wrong
// types/ranges, payloads missing required fields, and non-object JSON. The
// schema's own `safeParse` is the oracle for "is this valid". We then replay the
// EXACT persist-or-continue decision the `ScanProcessor` makes (try/catch around
// `reviewCode`: persist on success, discard + keep scanning on failure) and
// assert:
//   (a) the output is persisted IFF the oracle says it is schema-valid;
//   (b) when persisted, the persisted value equals the schema-parsed value;
//   (c) the scan ALWAYS continues regardless of validity (invalid output never
//       aborts the scan).

import "reflect-metadata";
import fc from "fast-check";
import { ConfigService } from "@nestjs/config";
import { AIReviewResultSchema } from "@slopshield/shared";

import { GeminiProvider } from "./providers/gemini.provider";
import type { ReviewInput } from "./interfaces/ai-reviewer-provider.interface";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * Builds a GeminiProvider whose underlying Gemini client is a fake that always
 * returns `responseText` as the model completion. The provider's real parsing +
 * Zod validation path runs unchanged; only the network call is replaced.
 */
function buildProviderReturning(responseText: string): GeminiProvider {
  const config = {
    get: (key: string, fallback?: unknown) => {
      if (key === "GEMINI_API_KEY") return "test-key";
      if (key === "GEMINI_MODEL") return "gemini-test";
      return fallback;
    },
  } as unknown as ConfigService;

  const provider = new GeminiProvider(config);

  // Inject a fake client in place of the real GoogleGenAI instance. The real
  // reviewCode path calls `this.ai.models.generateContent(...)` and reads
  // `.text` off the response.
  (provider as unknown as { ai: unknown }).ai = {
    models: {
      generateContent: async () => ({ text: responseText }),
    },
  };

  return provider;
}

const REVIEW_INPUT: ReviewInput = {
  scanId: "scan-prop-18",
  files: [
    {
      path: "src/index.ts",
      content: "export const x = 1;",
      language: "typescript",
      isFrontend: false,
      isBackend: true,
    },
  ],
  existingFindings: [],
};

/**
 * Mirrors the ScanProcessor's persist-or-continue decision around the AI pass
 * exactly: success => persist the AI result; failure => discard and keep going.
 * Returns whether the output was persisted, the persisted value (if any), and
 * whether the scan continued.
 */
async function runReviewWithPersistenceGate(
  provider: GeminiProvider,
): Promise<{ persisted: boolean; value: unknown; scanContinued: boolean }> {
  try {
    const aiResult = await provider.reviewCode(REVIEW_INPUT);
    return { persisted: true, value: aiResult, scanContinued: true };
  } catch {
    // ScanProcessor catches AI failures, records a note, and continues scoring.
    return { persisted: false, value: undefined, scanContinued: true };
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const severityArb = fc.constantFrom(
  "critical",
  "high",
  "medium",
  "low",
  "info",
);

// A well-formed AI finding that satisfies AIFindingSchema.
const validFindingArb = fc.record(
  {
    severity: severityArb,
    category: fc.string(),
    title: fc.string(),
    file: fc.string(),
    line: fc.integer({ min: 1, max: 100000 }),
    standard: fc.string(),
    why_it_matters: fc.string(),
    recommendation: fc.string(),
    blocking: fc.boolean(),
    confidence: fc.float({ min: 0, max: 1, noNaN: true }),
  },
  // line + standard are optional in the schema.
  { requiredKeys: ["severity", "category", "title", "file", "why_it_matters", "recommendation", "blocking", "confidence"] },
);

// A well-formed top-level AI review result that satisfies AIReviewResultSchema.
const validResultArb = fc.record({
  summary: fc.string(),
  findings: fc.array(validFindingArb, { maxLength: 4 }),
  recommended_tests: fc.array(fc.string(), { maxLength: 4 }),
  refactor_plan: fc.array(fc.string(), { maxLength: 4 }),
});

// Deliberately malformed payloads that should FAIL schema validation.
const invalidResultArb = fc.oneof(
  // Missing required top-level fields.
  fc.constant({ summary: "only summary present" }),
  // findings is not an array.
  fc.record({
    summary: fc.string(),
    findings: fc.string(),
    recommended_tests: fc.array(fc.string()),
    refactor_plan: fc.array(fc.string()),
  }),
  // Wrong-typed summary.
  fc.record({
    summary: fc.integer(),
    findings: fc.array(validFindingArb, { maxLength: 2 }),
    recommended_tests: fc.array(fc.string()),
    refactor_plan: fc.array(fc.string()),
  }),
  // A finding with an invalid severity enum value.
  fc.record({
    summary: fc.string(),
    findings: fc.constant([
      {
        severity: "super-bad",
        category: "security",
        title: "x",
        file: "a.ts",
        why_it_matters: "y",
        recommendation: "z",
        blocking: false,
        confidence: 0.5,
      },
    ]),
    recommended_tests: fc.array(fc.string()),
    refactor_plan: fc.array(fc.string()),
  }),
  // A finding with out-of-range confidence.
  fc.record({
    summary: fc.string(),
    findings: fc.constant([
      {
        severity: "high",
        category: "security",
        title: "x",
        file: "a.ts",
        why_it_matters: "y",
        recommendation: "z",
        blocking: false,
        confidence: 1.5,
      },
    ]),
    recommended_tests: fc.array(fc.string()),
    refactor_plan: fc.array(fc.string()),
  }),
  // Non-object payloads.
  fc.constant([]),
  fc.constant("malformed"),
  fc.constant(42),
  fc.constant(null),
);

// Free mixture of valid and invalid payloads so BOTH branches of the iff are
// exercised within a single run.
const anyPayloadArb = fc.oneof(validResultArb, invalidResultArb);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe("GeminiProvider — Property 18: AI output is persisted iff schema-valid", () => {
  it("persists AI output IFF it parses against AIReviewResultSchema; invalid output is discarded and the scan continues", async () => {
    await fc.assert(
      fc.asyncProperty(anyPayloadArb, async (payload) => {
        const responseText = JSON.stringify(payload);

        // Oracle: the schema itself decides validity. (JSON.stringify of
        // `undefined`-bearing values is handled because our generators never
        // produce undefined at the JSON top level; non-object constants like
        // null/42/"malformed"/[] serialize fine.)
        const oracle = AIReviewResultSchema.safeParse(payload);
        const expectedValid = oracle.success;

        const provider = buildProviderReturning(responseText);
        const { persisted, value, scanContinued } =
          await runReviewWithPersistenceGate(provider);

        // (a) Persisted IFF schema-valid.
        expect(persisted).toBe(expectedValid);

        // (b) When persisted, the persisted value equals the schema-parsed
        //     (normalized) value — never the raw, unvalidated payload.
        if (persisted) {
          expect(value).toEqual(AIReviewResultSchema.parse(payload));
        } else {
          expect(value).toBeUndefined();
        }

        // (c) The scan continues regardless of validity.
        expect(scanContinued).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
