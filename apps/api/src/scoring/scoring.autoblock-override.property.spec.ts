// Feature: production-grade-system, Property 23: Auto-block overrides bands entirely
//
// Validates: Requirements 7.3
//
// For any set of findings in which at least one finding matches an
// Auto_Block_Condition (or is marked blocking), the Status_Result is "blocked"
// with non-empty blocked reasons regardless of the overall score (including a
// score that would otherwise band as "passed"), and the band-based assignment
// is bypassed.

import fc from "fast-check";
import {
  Finding,
  FindingCategory,
  FindingSeverity,
  FindingSource,
  AUTO_BLOCK_CONDITIONS,
  getScoreStatus,
} from "@slopshield/shared";

import { ScoringService } from "./scoring.service";

describe("ScoringService — Property 23: Auto-block overrides bands entirely", () => {
  const service = new ScoringService();

  // Valid finding categories, severities, and sources for generators
  const allCategories: FindingCategory[] = [
    "backend-security",
    "frontend-security",
    "backend-architecture",
    "frontend-architecture",
    "maintainability",
    "testability",
    "accessibility",
    "reliability",
    "documentation",
    "general",
  ];

  const allSeverities: FindingSeverity[] = [
    "critical",
    "high",
    "medium",
    "low",
    "info",
  ];

  const allSources: FindingSource[] = [
    "eslint",
    "typescript",
    "secret-scanner",
    "semgrep",
    "rules-engine",
    "ai-reviewer",
  ];

  /**
   * Generates a non-blocking finding with any severity/category.
   * These may still incur score deductions, but they never trigger auto-block.
   */
  const nonBlockingFindingArbitrary = (
    index: number,
  ): fc.Arbitrary<Finding> =>
    fc
      .record({
        severity: fc.constantFrom(...allSeverities),
        category: fc.constantFrom(...allCategories),
        source: fc.constantFrom(...allSources),
        confidence: fc.float({ min: 0, max: 1, noNaN: true }),
      })
      .map(
        ({ severity, category, source, confidence }): Finding => ({
          id: `non-blocking-${index}`,
          scanId: "scan-prop23",
          severity,
          category,
          // Use a title that does NOT match any auto-block condition title
          title: `Generic issue number ${index}`,
          file: `src/file-${index}.ts`,
          standardReferences: [],
          whyItMatters: "Some concern.",
          recommendation: "Fix it.",
          blocking: false,
          confidence,
          source,
        }),
      );

  /**
   * Generates a finding that triggers auto-block by:
   * - Setting blocking: true
   * - Matching one of the AUTO_BLOCK_CONDITIONS (category + title)
   *
   * The severity is arbitrary — auto-block should trigger regardless of
   * severity as long as the finding is blocking and matches a condition.
   */
  const autoBlockFindingArbitrary: fc.Arbitrary<Finding> = fc
    .record({
      condition: fc.constantFrom(...AUTO_BLOCK_CONDITIONS),
      severity: fc.constantFrom(...allSeverities),
      source: fc.constantFrom(...allSources),
      confidence: fc.float({ min: 0, max: 1, noNaN: true }),
    })
    .map(
      ({ condition, severity, source, confidence }): Finding => ({
        id: `autoblock-${condition.id}`,
        scanId: "scan-prop23",
        severity,
        category: condition.category,
        title: condition.title,
        file: "src/vulnerable.ts",
        standardReferences: [],
        whyItMatters: condition.description,
        recommendation: "Remediate immediately.",
        blocking: true,
        confidence,
        source,
      }),
    );

  /**
   * Generates a finding that triggers auto-block purely via the `blocking`
   * flag without necessarily matching an AUTO_BLOCK_CONDITIONS title.
   * This covers the "or is marked blocking" part of the property.
   */
  const manualBlockingFindingArbitrary: fc.Arbitrary<Finding> = fc
    .record({
      severity: fc.constantFrom(...allSeverities),
      category: fc.constantFrom(...allCategories),
      source: fc.constantFrom(...allSources),
      confidence: fc.float({ min: 0, max: 1, noNaN: true }),
    })
    .map(
      ({ severity, category, source, confidence }): Finding => ({
        id: "manual-block-finding",
        scanId: "scan-prop23",
        severity,
        category,
        title: "Custom blocking rule violation",
        file: "src/blocked.ts",
        standardReferences: [],
        whyItMatters: "This is a custom block.",
        recommendation: "Resolve the blocking issue.",
        blocking: true,
        confidence,
        source,
      }),
    );

  it("forces statusResult='blocked' with non-empty blockedReasons when an auto-block condition finding is present, regardless of score", () => {
    fc.assert(
      fc.property(
        // 0 to 10 non-blocking findings (the score can be anything from 0 to 100)
        fc.array(
          fc.nat({ max: 9 }).chain((i) => nonBlockingFindingArbitrary(i)),
          { minLength: 0, maxLength: 10 },
        ),
        autoBlockFindingArbitrary,
        fc.nat({ max: 10 }),
        (nonBlocking, blockingFinding, insertPos) => {
          const findings = [...nonBlocking];
          const pos = Math.min(insertPos, findings.length);
          findings.splice(pos, 0, blockingFinding);

          const result = service.calculateScore(findings);

          // Property assertion: auto-block overrides bands entirely
          expect(result.statusResult).toBe("blocked");
          expect(result.blockedReasons.length).toBeGreaterThan(0);

          // Verify band-based assignment is bypassed: even if the computed
          // score would place in "passed" (90-100), verdict is still "blocked"
          const bandVerdict = getScoreStatus(result.overallScore);
          if (bandVerdict !== "blocked") {
            // When the band would NOT have been "blocked", the auto-block
            // overrides it — this is the core of the property
            expect(result.statusResult).toBe("blocked");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("forces statusResult='blocked' when a finding has blocking=true (manual block flag), regardless of score", () => {
    fc.assert(
      fc.property(
        // 0 to 5 non-blocking findings
        fc.array(
          fc.nat({ max: 4 }).chain((i) => nonBlockingFindingArbitrary(i)),
          { minLength: 0, maxLength: 5 },
        ),
        manualBlockingFindingArbitrary,
        (nonBlocking, blockingFinding) => {
          const findings = [...nonBlocking, blockingFinding];

          const result = service.calculateScore(findings);

          // Manual blocking flag must also trigger "blocked" verdict
          expect(result.statusResult).toBe("blocked");
          expect(result.blockedReasons.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("bypasses band assignment entirely when auto-block is active — even for scores in the 'passed' band (90-100)", () => {
    fc.assert(
      fc.property(
        // Use only info-severity non-blocking findings so the score stays high
        fc.array(
          fc.nat({ max: 2 }).chain((i) =>
            fc.constant<Finding>({
              id: `info-${i}`,
              scanId: "scan-prop23",
              severity: "info",
              category: "documentation",
              title: `Info note ${i}`,
              file: `src/info-${i}.ts`,
              standardReferences: [],
              whyItMatters: "Informational only.",
              recommendation: "Consider addressing.",
              blocking: false,
              confidence: 0.5,
              source: "eslint",
            }),
          ),
          { minLength: 0, maxLength: 3 },
        ),
        autoBlockFindingArbitrary,
        (infoFindings, blockingFinding) => {
          const findings = [...infoFindings, blockingFinding];

          const result = service.calculateScore(findings);

          // Even if the overall score is high (passed band), auto-block wins
          expect(result.statusResult).toBe("blocked");
          expect(result.blockedReasons.length).toBeGreaterThan(0);

          // Confirm the score itself may be high but verdict is still blocked
          // (this demonstrates band-bypass)
          if (result.overallScore >= 90) {
            expect(result.statusResult).toBe("blocked");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
