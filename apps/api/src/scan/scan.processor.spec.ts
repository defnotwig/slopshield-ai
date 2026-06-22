import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Job } from "bullmq";
import { ScanProcessor } from "./scan.processor.js";
import {
  PROCESSOR_METADATA,
  WORKER_METADATA,
} from "@nestjs/bullmq/dist/bull.constants.js";

/**
 * Unit tests for ScanProcessor free-tier guardrails.
 *
 * Covers:
 *  - @Processor("scan-pipeline", { concurrency: 1 }) worker options (8.2)
 *  - the processor still persists the deterministic static findings when
 *    GEMINI_API_KEY is absent and AI review yields nothing / fails (8.6)
 *
 * Validates: Requirements 8.2, 8.6
 */
describe("ScanProcessor guardrails", () => {
  describe("@Processor worker options — Requirement 8.2", () => {
    it("registers on the scan-pipeline queue", () => {
      const processorMeta = Reflect.getMetadata(
        PROCESSOR_METADATA,
        ScanProcessor,
      );
      expect(processorMeta).toEqual(
        expect.objectContaining({ name: "scan-pipeline" }),
      );
    });

    it("exposes a bounded worker concurrency of 1", () => {
      const workerMeta = Reflect.getMetadata(WORKER_METADATA, ScanProcessor);
      expect(workerMeta).toEqual(expect.objectContaining({ concurrency: 1 }));
    });
  });

  describe("AI-absent persistence — Requirement 8.6", () => {
    const SCAN_ID = "scan-ai-absent";
    let scanDir: string;
    const originalKey = process.env.GEMINI_API_KEY;

    // Mocks rebuilt per test for isolation.
    let prisma: any;
    let gateway: any;
    let orchestrator: any;
    let aiReviewer: any;
    let scoringService: any;
    let reportService: any;
    let larkService: any;
    let notificationService: any;

    const staticFindings = [
      {
        file: "src/app.service.ts",
        line: 12,
        severity: "high",
        category: "security",
        title: "Hardcoded secret",
        whyItMatters: "Secrets must not be committed.",
        standardReferences: ["OWASP-A02"],
        recommendation: "Move to env vars.",
        suggestedTests: [],
        blocking: true,
        confidence: 0.9,
        source: "secret-scanner",
        codeSnippet: "const k = 'AKIA...';",
      },
    ];

    const buildProcessor = () =>
      new ScanProcessor(
        prisma,
        gateway,
        orchestrator,
        aiReviewer,
        scoringService,
        reportService,
        larkService,
        notificationService,
      );

    const buildJob = (): Job<any, any, string> =>
      ({ data: { scanId: SCAN_ID, scanDir } }) as Job<any, any, string>;

    beforeEach(() => {
      // GEMINI_API_KEY absent simulates the no-AI deployment branch.
      delete process.env.GEMINI_API_KEY;

      // Real temp dir with a backend source file so the pipeline has work to do.
      scanDir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-proc-"));
      fs.mkdirSync(path.join(scanDir, "src"));
      fs.writeFileSync(
        path.join(scanDir, "src", "app.service.ts"),
        "export class AppService { run() { return 1; } }\n",
        "utf8",
      );

      prisma = {
        scanFile: { createMany: jest.fn().mockResolvedValue({}) },
        finding: {
          createMany: jest.fn().mockResolvedValue({}),
          findMany: jest.fn().mockResolvedValue([]),
        },
        scanJob: { update: jest.fn().mockResolvedValue({}) },
      };
      gateway = { broadcastProgress: jest.fn() };
      orchestrator = {
        runAll: jest.fn().mockResolvedValue(staticFindings),
      };
      // With no GEMINI_API_KEY, GeminiProvider runs in mock mode and yields an
      // empty review result; model that here.
      aiReviewer = {
        reviewCode: jest.fn().mockResolvedValue({
          findings: [],
          summary: "No issues identified.",
          refactor_plan: [],
          recommended_tests: [],
        }),
      };
      scoringService = {
        calculateScore: jest.fn().mockReturnValue({
          overallScore: 80,
          categoryScores: {
            security: 70,
            maintainability: 80,
            architecture: 80,
            testability: 80,
            frontend: 80,
            reliability: 80,
          },
          statusResult: "passed",
        }),
      };
      reportService = {};
      larkService = { sendScanCard: jest.fn().mockResolvedValue(undefined) };
      notificationService = {
        processScanNotifications: jest.fn().mockResolvedValue(undefined),
      };
    });

    afterEach(() => {
      if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = originalKey;
      if (fs.existsSync(scanDir)) {
        fs.rmSync(scanDir, { recursive: true, force: true });
      }
      jest.clearAllMocks();
    });

    it("persists the deterministic static findings when GEMINI_API_KEY is absent", async () => {
      const processor = buildProcessor();

      await processor.process(buildJob());

      // Static analyzers ran and findings were saved via prisma.
      expect(orchestrator.runAll).toHaveBeenCalledTimes(1);
      expect(prisma.finding.createMany).toHaveBeenCalledTimes(1);

      const saved = prisma.finding.createMany.mock.calls[0][0].data;
      // The single static finding is persisted.
      const staticSaved = saved.filter(
        (f: any) => f.source === "secret-scanner",
      );
      expect(staticSaved).toHaveLength(1);
      expect(staticSaved[0]).toEqual(
        expect.objectContaining({
          scanJobId: SCAN_ID,
          title: "Hardcoded secret",
          severity: "high",
          source: "secret-scanner",
        }),
      );
      // No AI findings were produced (no key → mock review returns none).
      expect(saved.some((f: any) => f.source === "ai-reviewer")).toBe(false);

      // The scan still completes (no failure status recorded).
      const statusUpdates = prisma.scanJob.update.mock.calls.map(
        (c: any[]) => c[0].data.status,
      );
      expect(statusUpdates).not.toContain("failed");
      expect(statusUpdates).toContain("completed");
    });

    it("still persists static findings even if the AI review pass throws", async () => {
      aiReviewer.reviewCode.mockRejectedValue(new Error("AI provider down"));
      const processor = buildProcessor();

      await processor.process(buildJob());

      // AI failure is swallowed; deterministic findings are still saved.
      expect(prisma.finding.createMany).toHaveBeenCalledTimes(1);
      const saved = prisma.finding.createMany.mock.calls[0][0].data;
      expect(
        saved.filter((f: any) => f.source === "secret-scanner"),
      ).toHaveLength(1);

      const statusUpdates = prisma.scanJob.update.mock.calls.map(
        (c: any[]) => c[0].data.status,
      );
      expect(statusUpdates).not.toContain("failed");
      expect(statusUpdates).toContain("completed");
    });
  });
});
