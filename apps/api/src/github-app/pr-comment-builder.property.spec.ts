import * as fc from "fast-check";
import { GitHubAppService } from "./github-app.service.js";
import { ScanResultSummary } from "./types.js";

/**
 * Property-based tests for PR comment body construction.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
 *
 * Property 6: PR comment completeness
 * - For any valid ScanResultSummary, the output contains the overallScore value
 * - For any valid ScanResultSummary, the output contains the statusResult/verdict string
 * - For any valid ScanResultSummary, the output contains severity count numbers
 * - For any valid ScanResultSummary, the output contains the reportUrl
 * - When findings exist, the output contains the titles of the top 5 (or fewer) findings
 * - When findings have standardReference values, those references appear in the output
 * - When there are more than 5 findings, only the first 5 appear
 */
describe("Feature: github-pr-status-checks, Property 6: PR comment completeness", () => {
  const service = new GitHubAppService(
    {} as any, // GitHubTokenService (unused by pure functions)
    {} as any, // AuditService (unused by pure functions)
    {} as any, // PrismaService (unused by pure functions)
    {} as any, // WebhookRateLimiter (unused by pure functions)
    {} as any, // RepositoryConfigService (unused by pure functions)
    {} as any, // Queue (unused by pure functions)
  );

  // ---------------------------------------------------------------------------
  // Arbitraries
  // ---------------------------------------------------------------------------

  const findingArb = fc.record({
    title: fc.string({ minLength: 1, maxLength: 100 }),
    severity: fc.constantFrom("critical", "high", "medium", "low", "info"),
    category: fc.string({ minLength: 1, maxLength: 50 }),
    standardReference: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  });

  const scanResultArb: fc.Arbitrary<ScanResultSummary> = fc.record({
    scanId: fc.uuid(),
    overallScore: fc.integer({ min: 0, max: 100 }),
    statusResult: fc.stringMatching(/^[a-z]{3,20}$/),
    findings: fc.array(findingArb, { minLength: 0, maxLength: 20 }),
    criticalCount: fc.integer({ min: 0, max: 999 }),
    highCount: fc.integer({ min: 0, max: 999 }),
    mediumCount: fc.integer({ min: 0, max: 999 }),
    lowCount: fc.integer({ min: 0, max: 999 }),
    infoCount: fc.integer({ min: 0, max: 999 }),
    reportUrl: fc.webUrl(),
  });

  // ---------------------------------------------------------------------------
  // Properties
  // ---------------------------------------------------------------------------

  describe("Output contains the overallScore value", () => {
    it("the comment body always includes the numeric score", () => {
      fc.assert(
        fc.property(scanResultArb, (scanResult) => {
          const body = service.buildPrCommentBody(scanResult);
          return body.includes(String(scanResult.overallScore));
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Output contains the statusResult/verdict string", () => {
    it("the comment body always includes the verdict", () => {
      fc.assert(
        fc.property(scanResultArb, (scanResult) => {
          const body = service.buildPrCommentBody(scanResult);
          return body.includes(scanResult.statusResult);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Output contains severity count numbers", () => {
    it("the comment body includes all severity counts", () => {
      fc.assert(
        fc.property(scanResultArb, (scanResult) => {
          const body = service.buildPrCommentBody(scanResult);
          return (
            body.includes(String(scanResult.criticalCount)) &&
            body.includes(String(scanResult.highCount)) &&
            body.includes(String(scanResult.mediumCount)) &&
            body.includes(String(scanResult.lowCount)) &&
            body.includes(String(scanResult.infoCount))
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Output contains the reportUrl", () => {
    it("the comment body always includes the report URL link", () => {
      fc.assert(
        fc.property(scanResultArb, (scanResult) => {
          const body = service.buildPrCommentBody(scanResult);
          return body.includes(scanResult.reportUrl);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("When findings exist, the output contains the titles of the top 5 (or fewer) findings", () => {
    it("the top min(5, findings.length) finding titles appear in the output", () => {
      const withFindingsArb = scanResultArb.filter(
        (sr) => sr.findings.length > 0,
      );

      fc.assert(
        fc.property(withFindingsArb, (scanResult) => {
          const body = service.buildPrCommentBody(scanResult);
          const topFindings = scanResult.findings.slice(0, 5);
          return topFindings.every((finding) => body.includes(finding.title));
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("When findings have standardReference values, those references appear in the output", () => {
    it("standard references from top 5 findings are included in the comment", () => {
      const withStandardRefArb = scanResultArb.filter(
        (sr) =>
          sr.findings.slice(0, 5).some((f) => f.standardReference !== undefined),
      );

      fc.assert(
        fc.property(withStandardRefArb, (scanResult) => {
          const body = service.buildPrCommentBody(scanResult);
          const topFindings = scanResult.findings.slice(0, 5);
          return topFindings
            .filter((f) => f.standardReference !== undefined)
            .every((f) => body.includes(f.standardReference!));
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("When there are more than 5 findings, only the first 5 appear", () => {
    it("the findings table has exactly 5 finding rows when more than 5 findings exist", () => {
      // Use distinctive titles to avoid collisions with markdown syntax
      const distinctFindingArb = fc.record({
        title: fc.stringMatching(/^[A-Z][a-z]{4,20} [A-Z][a-z]{4,20}$/),
        severity: fc.constantFrom("critical", "high", "medium", "low", "info"),
        category: fc.stringMatching(/^[A-Z][a-z]{4,15}$/),
        standardReference: fc.option(
          fc.stringMatching(/^STD-[A-Z]{2,5}-\d{3}$/),
          { nil: undefined },
        ),
      });

      const manyFindingsResultArb = fc.record({
        scanId: fc.uuid(),
        overallScore: fc.integer({ min: 0, max: 100 }),
        statusResult: fc.stringMatching(/^[a-z]{3,20}$/),
        findings: fc.array(distinctFindingArb, { minLength: 6, maxLength: 20 }),
        criticalCount: fc.integer({ min: 0, max: 999 }),
        highCount: fc.integer({ min: 0, max: 999 }),
        mediumCount: fc.integer({ min: 0, max: 999 }),
        lowCount: fc.integer({ min: 0, max: 999 }),
        infoCount: fc.integer({ min: 0, max: 999 }),
        reportUrl: fc.webUrl(),
      });

      fc.assert(
        fc.property(manyFindingsResultArb, (scanResult) => {
          const body = service.buildPrCommentBody(scanResult);

          // Extract the "Top Findings" section from the markdown
          const topFindingsSection = body.split("### Top Findings")[1] ?? "";

          // The first 5 finding titles must appear in the section
          const topFindings = scanResult.findings.slice(0, 5);
          const topTitlesPresent = topFindings.every((f) =>
            topFindingsSection.includes(f.title),
          );

          // Count data rows in the findings table (| number | title | ...)
          // The pattern matches rows like "| 1 | Title | severity | ..."
          const findingRowPattern = /^\| [1-5] \|/gm;
          const findingRows = topFindingsSection.match(findingRowPattern) ?? [];
          const exactlyFiveRows = findingRows.length === 5;

          return topTitlesPresent && exactlyFiveRows;
        }),
        { numRuns: 100 },
      );
    });
  });
});
