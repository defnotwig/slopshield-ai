/**
 * Feature: production-grade-system, Property 27: Lark outcome never blocks scan completion
 *
 * For any Lark delivery outcome (success, failure, skip, or thrown error),
 * the Scan_Worker still drives the scan to a completed state.
 *
 * Validates: Requirements 9.6
 */
import "reflect-metadata";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import fc from "fast-check";
import { Job } from "bullmq";
import { ScanProcessor } from "./scan.processor";

/**
 * The possible Lark delivery outcomes the property must hold over.
 * Each represents a distinct way `LarkService.sendScanCard` can behave:
 *  - "success": resolves true (webhook delivered)
 *  - "failure": resolves false (webhook returned non-2xx)
 *  - "throw": rejects with an Error (transport/network failure)
 *  - "timeout": rejects with a timeout-style error
 *  - "skip": resolves true (webhook unconfigured, event recorded as skipped)
 */
type LarkOutcome = "success" | "failure" | "throw" | "timeout" | "skip";

const ALL_LARK_OUTCOMES: LarkOutcome[] = [
  "success",
  "failure",
  "throw",
  "timeout",
  "skip",
];

describe("ScanProcessor — Property 27: Lark outcome never blocks scan completion", () => {
  let scanDir: string;
  const SCAN_ID = "scan-lark-prop27";

  beforeEach(() => {
    // Create a real temp directory with a minimal source file so the
    // pipeline has valid input to process.
    scanDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-lark-prop27-"));
    fs.mkdirSync(path.join(scanDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(scanDir, "src", "index.ts"),
      'export const hello = "world";\n',
      "utf8",
    );
  });

  afterEach(() => {
    if (fs.existsSync(scanDir)) {
      fs.rmSync(scanDir, { recursive: true, force: true });
    }
    jest.restoreAllMocks();
  });

  /**
   * Build a mock LarkService whose `sendScanCard` behaves according to the
   * given outcome.
   */
  function buildLarkService(outcome: LarkOutcome) {
    switch (outcome) {
      case "success":
        return { sendScanCard: jest.fn().mockResolvedValue(true) };
      case "failure":
        return { sendScanCard: jest.fn().mockResolvedValue(false) };
      case "throw":
        return {
          sendScanCard: jest
            .fn()
            .mockRejectedValue(new Error("Lark webhook POST failed")),
        };
      case "timeout":
        return {
          sendScanCard: jest
            .fn()
            .mockRejectedValue(new Error("Lark request timed out")),
        };
      case "skip":
        // When webhook is unconfigured, the service logs "skipped" and resolves true.
        return { sendScanCard: jest.fn().mockResolvedValue(true) };
    }
  }

  /**
   * Build the full set of mocked dependencies for the ScanProcessor,
   * parameterized only by the Lark outcome.
   */
  function buildDeps(larkOutcome: LarkOutcome) {
    const prisma = {
      scanFile: { createMany: jest.fn().mockResolvedValue({}) },
      finding: {
        createMany: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      scanJob: { update: jest.fn().mockResolvedValue({}) },
    };

    const gateway = { broadcastProgress: jest.fn() };

    const orchestrator = {
      runAll: jest.fn().mockResolvedValue({
        findings: [
          {
            file: "src/index.ts",
            line: 1,
            severity: "low",
            category: "maintainability",
            title: "Unused export",
            whyItMatters: "Dead code adds confusion.",
            standardReferences: ["ISO-25010"],
            recommendation: "Remove unused exports.",
            suggestedTests: [],
            blocking: false,
            confidence: 0.8,
            source: "typescript",
            codeSnippet: 'export const hello = "world";',
          },
        ],
        coverage: [
          {
            analyzer: "typescript",
            status: "ran",
            findingCount: 1,
            durationMs: 50,
          },
        ],
      }),
    };

    const aiReviewer = {
      reviewCode: jest.fn().mockResolvedValue({
        findings: [],
        summary: "No issues identified.",
        refactor_plan: [],
        recommended_tests: [],
      }),
    };

    const scoringService = {
      calculateScore: jest.fn().mockReturnValue({
        overallScore: 95,
        categoryScores: {
          security: 100,
          maintainability: 90,
          architecture: 95,
          testability: 95,
          frontend: 95,
          reliability: 95,
        },
        statusResult: "passed",
      }),
    };

    const reportService = {};
    const larkService = buildLarkService(larkOutcome);
    const notificationService = {
      processScanNotifications: jest.fn().mockResolvedValue(undefined),
    };

    return {
      prisma,
      gateway,
      orchestrator,
      aiReviewer,
      scoringService,
      reportService,
      larkService,
      notificationService,
    };
  }

  it("drives the scan to a terminal state regardless of Lark delivery outcome", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_LARK_OUTCOMES),
        // A nonce to ensure distinct scanDir names per iteration when needed.
        fc.integer({ min: 0, max: 1_000_000 }),
        async (larkOutcome, nonce) => {
          // Use unique scanDir per iteration to avoid cross-contamination.
          const iterScanDir = path.join(scanDir, `iter-${nonce}`);
          fs.mkdirSync(path.join(iterScanDir, "src"), { recursive: true });
          fs.writeFileSync(
            path.join(iterScanDir, "src", "index.ts"),
            `export const v = ${nonce};\n`,
            "utf8",
          );

          const deps = buildDeps(larkOutcome);

          const processor = new ScanProcessor(
            deps.prisma as any,
            deps.gateway as any,
            deps.orchestrator as any,
            deps.aiReviewer as any,
            deps.scoringService as any,
            deps.reportService as any,
            deps.larkService as any,
            deps.notificationService as any,
            { emit: jest.fn() } as any,
          );

          const job = {
            data: { scanId: `${SCAN_ID}-${nonce}`, scanDir: iterScanDir },
          } as Job<any, any, string>;

          // Run the processor — it must NOT throw regardless of Lark outcome.
          await processor.process(job);

          // Verify the scan reached a terminal state. The updateProgress calls
          // record the status on the ScanJob. The final status should be
          // either "completed" or "failed" — never stuck at "notifying".
          const statusUpdates: string[] =
            deps.prisma.scanJob.update.mock.calls.map(
              (call: any[]) => call[0].data.status,
            );

          // The scan must have a terminal stage recorded.
          const hasTerminal =
            statusUpdates.includes("completed") ||
            statusUpdates.includes("failed");
          expect(hasTerminal).toBe(true);

          // The scan must NOT be stuck at the notifying stage.
          const lastStatus = statusUpdates[statusUpdates.length - 1];
          expect(lastStatus).not.toBe("notifying");

          // The scan should have reached "completed" (since the pipeline
          // catches Lark errors and continues).
          expect(statusUpdates).toContain("completed");
        },
      ),
      { numRuns: 100 },
    );
  }, 120000);
});
