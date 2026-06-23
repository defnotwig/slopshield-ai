// Feature: production-grade-system, Property 15: Scan directory is always cleaned up
import "reflect-metadata";
import fc from "fast-check";
import * as fs from "node:fs";
import * as path from "node:path";
import { ScanProcessor } from "./scan.processor.js";
import { ScanService } from "./scan.service.js";

/**
 * Property 15: Scan directory is always cleaned up
 *
 * For any terminal or non-success outcome of a scan (completed, failed, timed
 * out, or cancelled), the Scan_Worker removes the Scan_Directory and its
 * temporary contents.
 *
 * Cleanup is implemented in two collaborators:
 *  - {@link ScanProcessor.process} removes the Scan_Directory in a `finally`
 *    block, so it runs whether the pipeline completes or throws (failure /
 *    timeout are both surfaced as a thrown error inside the pipeline).
 *  - {@link ScanService.cancelScan} removes the Scan_Directory when a queued /
 *    in-flight job is cancelled before or after the worker runs.
 *
 * Strategy: fast-check chooses a terminal outcome and an arbitrary set of
 * source files. A real Scan_Directory (`temp-scans/{scanId}`) is populated on
 * disk, then the matching code path is driven with in-memory doubles for every
 * external collaborator (Prisma, queue, gateway, analyzers, AI, scoring,
 * notifications). After the outcome resolves we assert the directory no longer
 * exists on disk.
 *
 * Validates: Requirements 4.10
 */

const tempBaseDir = path.join(process.cwd(), "temp-scans");

/** A small arbitrary set of source files to populate a Scan_Directory with. */
const filesArb = fc.array(
  fc.record({
    name: fc.stringMatching(/^[a-z][a-z0-9_]{0,10}\.(ts|tsx|js|json|md)$/),
    content: fc.string({ maxLength: 64 }),
  }),
  { minLength: 0, maxLength: 6 },
);

/** The terminal outcomes a scan can reach, all of which must clean up. */
const outcomeArb = fc.constantFrom<
  "completed" | "failed" | "timeout" | "cancelled"
>("completed", "failed", "timeout", "cancelled");

/** Build a real Scan_Directory on disk with unique-named files. */
function seedScanDir(
  scanId: string,
  files: { name: string; content: string }[],
): string {
  const scanDir = path.join(tempBaseDir, scanId);
  fs.mkdirSync(scanDir, { recursive: true });
  const used = new Set<string>();
  for (const f of files) {
    let name = f.name;
    let i = 0;
    while (used.has(name)) {
      name = `${i++}_${f.name}`;
    }
    used.add(name);
    fs.writeFileSync(path.join(scanDir, name), f.content, "utf8");
  }
  return scanDir;
}

/** A scoring result shaped the way ScanProcessor.process consumes it. */
function fakeScore() {
  return {
    overallScore: 100,
    statusResult: "passed",
    categoryScores: {
      security: 100,
      maintainability: 100,
      architecture: 100,
      testability: 100,
      frontend: 100,
      reliability: 100,
    },
  };
}

/** Stub collaborators for ScanProcessor; `failPipeline` forces a thrown error. */
function makeProcessor(failPipeline: boolean): ScanProcessor {
  const prisma: any = {
    scanFile: { createMany: jest.fn().mockResolvedValue(undefined) },
    finding: {
      createMany: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([]),
    },
    scanJob: { update: jest.fn().mockResolvedValue(undefined) },
  };
  const gateway: any = { broadcastProgress: jest.fn() };
  const orchestrator: any = {
    runAll: failPipeline
      ? jest.fn().mockRejectedValue(new Error("pipeline aborted (timeout)"))
      : jest.fn().mockResolvedValue({ findings: [], coverage: {} }),
  };
  const aiReviewer: any = {
    reviewCode: jest.fn().mockResolvedValue({
      findings: [],
      summary: "ok",
      refactor_plan: [],
      recommended_tests: [],
    }),
  };
  const scoringService: any = {
    calculateScore: jest.fn().mockReturnValue(fakeScore()),
  };
  const reportService: any = {};
  const larkService: any = { sendScanCard: jest.fn().mockResolvedValue(undefined) };
  const notificationService: any = {
    processScanNotifications: jest.fn().mockResolvedValue(undefined),
  };

  return new ScanProcessor(
    prisma,
    gateway,
    orchestrator,
    aiReviewer,
    scoringService,
    reportService,
    larkService,
    notificationService,
    { emit: jest.fn() } as any,
  );
}

describe("Scan_Worker — Property 15: Scan directory is always cleaned up", () => {
  const createdScanDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdScanDirs) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    createdScanDirs.length = 0;
    jest.clearAllMocks();
  });

  it("removes the Scan_Directory for every terminal outcome", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        outcomeArb,
        filesArb,
        async (scanId, outcome, files) => {
          const scanDir = seedScanDir(scanId, files);
          createdScanDirs.push(scanDir);

          // Sanity: the directory exists before the terminal outcome runs.
          expect(fs.existsSync(scanDir)).toBe(true);

          if (outcome === "cancelled") {
            // Cancellation path lives in ScanService.cancelScan.
            const prisma: any = {
              scanJob: {
                findUnique: jest.fn().mockResolvedValue({
                  id: scanId,
                  status: "queued",
                  findings: [],
                  scanFiles: [],
                }),
                update: jest
                  .fn()
                  .mockResolvedValue({ id: scanId, status: "cancelled" }),
              },
            };
            const scanQueue: any = { add: jest.fn() };
            const githubIngestion: any = { ingest: jest.fn() };
            const service = new ScanService(prisma, scanQueue, githubIngestion);
            await service.cancelScan(scanId);
          } else {
            // completed / failed / timeout all flow through the worker; failed
            // and timeout are modeled as a thrown error inside the pipeline.
            const processor = makeProcessor(outcome !== "completed");
            await processor.process({
              data: { scanId, scanDir },
            } as any);
          }

          // The Scan_Directory and its contents must be gone afterward.
          expect(fs.existsSync(scanDir)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
