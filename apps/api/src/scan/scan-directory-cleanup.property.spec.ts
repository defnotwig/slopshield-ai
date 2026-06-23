// Feature: production-grade-system, Property 15: Scan directory is always cleaned up
//
// Property 15: Scan directory is always cleaned up
// **Validates: Requirements 4.10**
//
// For any terminal or non-success outcome of a scan (completed, failed, timed
// out, or cancelled), the Scan_Worker removes the Scan_Directory and its
// temporary contents. This test verifies that the ScanProcessor's `process()`
// method always cleans up the scan directory regardless of outcome — success,
// orchestrator failure, AI review failure, Lark failure, scoring failure, or a
// crash at any pipeline stage.

import "reflect-metadata";
import fc from "fast-check";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ScanProcessor } from "./scan.processor";

/**
 * The possible scan outcomes the property exercises. Each outcome is simulated
 * by configuring the mock dependencies to either succeed or throw at specific
 * pipeline stages.
 */
type ScanOutcome =
  | "completed"        // happy path — all stages succeed
  | "dir-missing"      // scan directory does not exist when the processor runs
  | "orchestrator-fail" // ScannerOrchestrator.runAll throws
  | "ai-review-fail"   // AIReviewerService.reviewCode throws
  | "scoring-fail"     // ScoringService.calculateScore throws
  | "lark-fail"        // LarkService.sendScanCard throws
  | "notification-fail" // NotificationService fails
  | "prisma-update-fail"; // Prisma update in the happy path throws

const ALL_OUTCOMES: ScanOutcome[] = [
  "completed",
  "dir-missing",
  "orchestrator-fail",
  "ai-review-fail",
  "scoring-fail",
  "lark-fail",
  "notification-fail",
  "prisma-update-fail",
];

/** Seed a scan directory with some files so cleanup is provably removing content. */
function seedScanDir(scanDir: string): void {
  fs.mkdirSync(scanDir, { recursive: true });
  fs.writeFileSync(path.join(scanDir, "index.ts"), "export const x = 1;\n");
  fs.mkdirSync(path.join(scanDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(scanDir, "src", "util.ts"), "export const y = 2;\n");
}

/** Build mock dependencies configured to trigger the given outcome. */
function buildMocks(outcome: ScanOutcome) {
  const mockPrisma = {
    scanJob: {
      update: jest.fn().mockImplementation(async () => {
        if (outcome === "prisma-update-fail") {
          throw new Error("Simulated Prisma update failure");
        }
        return {};
      }),
    },
    scanFile: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finding: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const mockGateway = {
    broadcastProgress: jest.fn(),
  };

  const mockOrchestrator = {
    runAll: jest.fn().mockImplementation(async () => {
      if (outcome === "orchestrator-fail") {
        throw new Error("Simulated orchestrator crash");
      }
      return { findings: [], coverage: [] };
    }),
  };

  const mockAiReviewer = {
    reviewCode: jest.fn().mockImplementation(async () => {
      if (outcome === "ai-review-fail") {
        throw new Error("Simulated AI review failure");
      }
      return { findings: [], summary: "OK", refactor_plan: [], recommended_tests: [] };
    }),
  };

  const mockScoringService = {
    calculateScore: jest.fn().mockImplementation(() => {
      if (outcome === "scoring-fail") {
        throw new Error("Simulated scoring failure");
      }
      return {
        overallScore: 95,
        statusResult: "passed",
        categoryScores: {
          security: 90,
          maintainability: 95,
          architecture: 90,
          testability: 95,
          frontend: 90,
          reliability: 90,
        },
        blockedReasons: [],
      };
    }),
  };

  const mockReportService = {};

  const mockLarkService = {
    sendScanCard: jest.fn().mockImplementation(async () => {
      if (outcome === "lark-fail") {
        throw new Error("Simulated Lark delivery failure");
      }
    }),
  };

  const mockNotificationService = {
    processScanNotifications: jest.fn().mockImplementation(async () => {
      if (outcome === "notification-fail") {
        throw new Error("Simulated notification failure");
      }
    }),
  };

  return {
    prisma: mockPrisma,
    gateway: mockGateway,
    orchestrator: mockOrchestrator,
    aiReviewer: mockAiReviewer,
    scoringService: mockScoringService,
    reportService: mockReportService,
    larkService: mockLarkService,
    notificationService: mockNotificationService,
  };
}

describe("ScanProcessor — Property 15: Scan directory is always cleaned up", () => {
  let workRoot: string;

  beforeEach(() => {
    workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ss-cleanup-prop15-"));
  });

  afterEach(() => {
    fs.rmSync(workRoot, { recursive: true, force: true });
  });

  it("removes the scan directory for any scan outcome (completion, failure, crash at any stage)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_OUTCOMES),
        // A nonce to make each iteration use a distinct scanDir path.
        fc.integer({ min: 0, max: 1_000_000 }),
        async (outcome, nonce) => {
          const scanDir = path.join(workRoot, `scan-${outcome}-${nonce}`);
          const scanId = `test-scan-${outcome}-${nonce}`;

          // For the "dir-missing" outcome, do NOT create the directory.
          // For all other outcomes, seed the directory with real files.
          if (outcome !== "dir-missing") {
            seedScanDir(scanDir);
            expect(fs.existsSync(scanDir)).toBe(true);
          }

          const mocks = buildMocks(outcome);

          // Construct the ScanProcessor with mocked dependencies.
          const processor = new ScanProcessor(
            mocks.prisma as any,
            mocks.gateway as any,
            mocks.orchestrator as any,
            mocks.aiReviewer as any,
            mocks.scoringService as any,
            mocks.reportService as any,
            mocks.larkService as any,
            mocks.notificationService as any,
            { emit: jest.fn() } as any,
          );

          // Build a minimal BullMQ Job-like object.
          const fakeJob = {
            data: { scanId, scanDir },
            id: scanId,
            name: "process-scan",
          };

          // Execute the processor — it should never throw to the caller
          // because it catches errors internally and updates the scan status.
          try {
            await processor.process(fakeJob as any);
          } catch {
            // Some outcomes (like prisma-update-fail in the catch block itself)
            // may still throw; the property asserts cleanup happened regardless.
          }

          // PROPERTY ASSERTION: the scan directory must not exist after
          // processing, regardless of the outcome.
          expect(fs.existsSync(scanDir)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  }, 120000);

  it("removes the scan directory even when it contains deeply nested content", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a random nesting depth (1-5 levels) and file count (1-4).
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        async (depth, fileCount, nonce) => {
          const scanDir = path.join(workRoot, `scan-deep-${nonce}`);
          fs.mkdirSync(scanDir, { recursive: true });

          // Create nested directories and files.
          let nestedPath = scanDir;
          for (let d = 0; d < depth; d++) {
            nestedPath = path.join(nestedPath, `level-${d}`);
            fs.mkdirSync(nestedPath, { recursive: true });
          }
          for (let f = 0; f < fileCount; f++) {
            fs.writeFileSync(
              path.join(nestedPath, `file-${f}.ts`),
              `export const v${f} = ${f};\n`,
            );
          }

          expect(fs.existsSync(scanDir)).toBe(true);

          // Use the "completed" outcome to focus on content-depth behavior.
          const mocks = buildMocks("completed");
          const processor = new ScanProcessor(
            mocks.prisma as any,
            mocks.gateway as any,
            mocks.orchestrator as any,
            mocks.aiReviewer as any,
            mocks.scoringService as any,
            mocks.reportService as any,
            mocks.larkService as any,
            mocks.notificationService as any,
            { emit: jest.fn() } as any,
          );

          const fakeJob = {
            data: { scanId: `deep-${nonce}`, scanDir },
            id: `deep-${nonce}`,
            name: "process-scan",
          };

          try {
            await processor.process(fakeJob as any);
          } catch {
            // Swallow — property is about cleanup, not success.
          }

          // The scan directory and all nested content must be gone.
          expect(fs.existsSync(scanDir)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  }, 120000);
});
