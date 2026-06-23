// Feature: production-grade-system, Property 8: Create-scan accepts a body iff it conforms to the shared schema
import "reflect-metadata";
import fc from "fast-check";
import { BadRequestException } from "@nestjs/common";
import {
  CreateScanInputSchema,
  SOURCE_TYPE,
  SourceTypeEnum,
  ScanModeEnum,
} from "@slopshield/shared";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";

/**
 * Property 8: Create-scan accepts a body iff it conforms to the shared schema
 *
 * For any request payload, the API accepts the create-scan request if and only
 * if it parses successfully against `CreateScanInputSchema` (with `sourceType`
 * drawn from the shared `SOURCE_TYPE` constant), and otherwise rejects it with
 * HTTP 400.
 *
 * Strategy: fast-check generates two classes of payloads:
 *   (A) Valid payloads — `sourceType` drawn from `SOURCE_TYPE` values,
 *       optional fields conforming to their constraints (uuid projectId,
 *       valid scanMode). The pipe must accept these without throwing.
 *   (B) Invalid payloads — bodies with missing/malformed sourceType, invalid
 *       projectId (non-uuid), invalid scanMode, wrong types for fields, or
 *       completely arbitrary JSON. The pipe must reject with BadRequestException.
 *
 * The test validates both directions of the "iff" biconditional in a single
 * property run: for every generated payload, we compare the pipe's behavior
 * against an independent schema parse attempt to confirm agreement.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 10.1
 */

const pipe = new ZodValidationPipe(CreateScanInputSchema);

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Valid source type values drawn from the shared constant. */
const validSourceType = fc.constantFrom(
  SOURCE_TYPE.PASTE,
  SOURCE_TYPE.UPLOAD,
  SOURCE_TYPE.REPOSITORY,
  SOURCE_TYPE.DEMO_SAMPLE,
);

/** Valid scan mode values. */
const validScanMode = fc.constantFrom(
  "full",
  "fast",
  "security-only",
  "frontend-only",
  "backend-only",
);

/** A valid UUID v4. */
const validUuid = fc.uuid();

/** Generator for valid create-scan payloads. */
const validPayload = fc.record(
  {
    sourceType: validSourceType,
    projectId: fc.option(validUuid, { nil: undefined }),
    sourceContent: fc.option(fc.string({ minLength: 1, maxLength: 200 }), {
      nil: undefined,
    }),
    sourceRef: fc.option(
      fc
        .record({
          owner: fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
          repo: fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
        })
        .map(({ owner, repo }) => `https://github.com/${owner}/${repo}`),
      { nil: undefined },
    ),
    scanMode: fc.option(validScanMode, { nil: undefined }),
    demoSampleId: fc.option(fc.string({ minLength: 1, maxLength: 30 }), {
      nil: undefined,
    }),
  },
  { requiredKeys: ["sourceType"] },
);

/** Generates a payload with an invalid sourceType (not in the enum). */
const invalidSourceType = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter(
    (s) =>
      !SourceTypeEnum.options.includes(s as any),
  )
  .map((sourceType) => ({
    sourceType,
    scanMode: "full",
  }));

/** Generates a payload with a missing sourceType. */
const missingSourceType = fc
  .record({
    sourceContent: fc.option(fc.string(), { nil: undefined }),
    sourceRef: fc.option(fc.string(), { nil: undefined }),
    scanMode: fc.option(validScanMode, { nil: undefined }),
  })
  .map((rec) => {
    // Ensure sourceType is NOT present
    const obj: Record<string, unknown> = { ...rec };
    delete obj.sourceType;
    return obj;
  });

/** Generates a payload with a non-uuid projectId. */
const invalidProjectId = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => {
    // Reject strings that happen to be valid UUIDs
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return !uuidRegex.test(s);
  })
  .map((badId) => ({
    sourceType: SOURCE_TYPE.REPOSITORY,
    projectId: badId,
    scanMode: "full",
  }));

/** Generates a payload with an invalid scanMode. */
const invalidScanMode = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter(
    (s) =>
      !ScanModeEnum.options.includes(s as any),
  )
  .map((badMode) => ({
    sourceType: SOURCE_TYPE.PASTE,
    sourceContent: "console.log('hi')",
    scanMode: badMode,
  }));

/** Generates completely arbitrary JSON objects. */
const arbitraryObject = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 10 }),
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.array(fc.string(), { maxLength: 3 }),
  ),
  { minKeys: 0, maxKeys: 8 },
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Feature: production-grade-system, Property 8: Create-scan accepts a body iff it conforms to the shared schema", () => {
  it("accepts all valid payloads conforming to CreateScanInputSchema (≥100 iterations)", () => {
    fc.assert(
      fc.property(validPayload, (payload) => {
        // Remove undefined keys to simulate how the controller assembles the payload
        const assembled: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(payload)) {
          if (value !== undefined) {
            assembled[key] = value;
          }
        }

        // Must not throw — valid payloads are accepted
        const result = pipe.transform(assembled);

        // sourceType is preserved as a valid SOURCE_TYPE value
        expect(SourceTypeEnum.safeParse(result.sourceType).success).toBe(true);

        // scanMode defaults to "full" when not provided
        expect(ScanModeEnum.safeParse(result.scanMode).success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects payloads with invalid sourceType with HTTP 400 (≥100 iterations)", () => {
    fc.assert(
      fc.property(invalidSourceType, (payload) => {
        expect(() => pipe.transform(payload)).toThrow(BadRequestException);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects payloads with missing sourceType with HTTP 400 (≥100 iterations)", () => {
    fc.assert(
      fc.property(missingSourceType, (payload) => {
        expect(() => pipe.transform(payload)).toThrow(BadRequestException);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects payloads with non-uuid projectId with HTTP 400 (≥100 iterations)", () => {
    fc.assert(
      fc.property(invalidProjectId, (payload) => {
        expect(() => pipe.transform(payload)).toThrow(BadRequestException);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects payloads with invalid scanMode with HTTP 400 (≥100 iterations)", () => {
    fc.assert(
      fc.property(invalidScanMode, (payload) => {
        expect(() => pipe.transform(payload)).toThrow(BadRequestException);
      }),
      { numRuns: 100 },
    );
  });

  it("biconditional: pipe agrees with schema parse for arbitrary objects (≥100 iterations)", () => {
    fc.assert(
      fc.property(arbitraryObject, (payload) => {
        const schemaResult = CreateScanInputSchema.safeParse(payload);
        let pipeAccepted: boolean;
        try {
          pipe.transform(payload);
          pipeAccepted = true;
        } catch (error) {
          if (error instanceof BadRequestException) {
            pipeAccepted = false;
          } else {
            throw error; // unexpected error
          }
        }

        // The pipe accepts iff the schema accepts — biconditional
        expect(pipeAccepted).toBe(schemaResult.success);
      }),
      { numRuns: 100 },
    );
  });
});
