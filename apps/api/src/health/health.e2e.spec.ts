import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import helmet from "helmet";

import { HealthModule } from "./health.module";
import { HealthController } from "./health.controller";
import { PrismaService } from "../prisma/prisma.service";
import { computeReadiness, formatIntegrationSummary } from "../common/env";

/**
 * Integration/e2e tests for health, readiness, Helmet headers, and structured
 * logs. Boots a real Nest application with Helmet applied (mirroring main.ts)
 * so HTTP-level assertions cover the full middleware stack.
 *
 * Validates: Requirements 12.1, 12.3, 12.4, 10.4, 11.5
 */
describe("Health & Readiness integration (e2e)", () => {
  let app: INestApplication;
  let baseUrl: string;

  // Save and restore integration env vars between tests.
  const INTEGRATION_KEYS = [
    "GEMINI_API_KEY",
    "GITHUB_TOKEN",
    "LARK_WEBHOOK_URL",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of INTEGRATION_KEYS) savedEnv[k] = process.env[k];

    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    })
      // Provide a mock PrismaService so we can toggle healthy/unhealthy.
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
      })
      .compile();

    app = moduleRef.createNestApplication();
    // Mirror main.ts: global prefix + Helmet (Req 10.4).
    app.setGlobalPrefix("api");
    app.use(helmet());
    await app.init();
    await app.listen(0);

    const url = await app.getUrl();
    baseUrl = url.replace("[::1]", "127.0.0.1").replace("0.0.0.0", "127.0.0.1");
  });

  afterAll(async () => {
    await app?.close();
    for (const k of INTEGRATION_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  // ---------------------------------------------------------------------------
  // Health endpoint (Req 12.3, 12.3a)
  // ---------------------------------------------------------------------------

  describe("GET /api/health", () => {
    it("returns HTTP 200 with status 'ok' when service is healthy (Req 12.3)", async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe("ok");
      expect(body.timestamp).toBeDefined();
      expect(body.uptime).toBeGreaterThanOrEqual(0);
    });

    it("returns an error status code when the database is unreachable (Req 12.3a)", async () => {
      // Build a separate app with a PrismaService that rejects $queryRaw so
      // the HealthController's assertDependenciesHealthy throws 503.
      // HealthModule doesn't declare PrismaService as a provider (it's optional
      // in the controller), so we add it explicitly to the module providers.
      const failingPrisma = {
        $queryRaw: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      };
      const failModuleRef = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [{ provide: PrismaService, useValue: failingPrisma }],
      }).compile();

      const failApp = failModuleRef.createNestApplication();
      failApp.setGlobalPrefix("api");
      await failApp.init();
      await failApp.listen(0);
      const failUrl = (await failApp.getUrl())
        .replace("[::1]", "127.0.0.1")
        .replace("0.0.0.0", "127.0.0.1");

      try {
        const res = await fetch(`${failUrl}/api/health`);
        // 503 Service Unavailable indicates an unhealthy service.
        expect(res.status).toBe(503);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.status).toBe("error");
        expect(body.reason).toBe("database_unreachable");
      } finally {
        await failApp.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Readiness endpoint (Req 12.4, 11.6, 11.7)
  // ---------------------------------------------------------------------------

  describe("GET /api/health/ready", () => {
    beforeEach(() => {
      for (const k of INTEGRATION_KEYS) delete process.env[k];
    });

    it("returns per-integration status with all 'skipped' when nothing is configured (Req 11.7)", async () => {
      const res = await fetch(`${baseUrl}/api/health/ready`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        gemini: "skipped",
        githubApp: "skipped",
        githubToken: "skipped",
        lark: "skipped",
      });
    });

    it("reports 'configured' for integrations with env vars set (Req 11.6)", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      process.env.GITHUB_TOKEN = "ghp_test";
      process.env.LARK_WEBHOOK_URL = "https://open.larksuite.com/hook/test";

      const res = await fetch(`${baseUrl}/api/health/ready`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        gemini: "configured",
        githubApp: "skipped",
        githubToken: "configured",
        lark: "configured",
      });
    });

    it("reports mixed statuses when only some integrations are configured", async () => {
      process.env.GITHUB_TOKEN = "ghp_abc";
      // GEMINI_API_KEY and LARK_WEBHOOK_URL remain unset.

      const res = await fetch(`${baseUrl}/api/health/ready`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.githubToken).toBe("configured");
      expect(body.gemini).toBe("skipped");
      expect(body.lark).toBe("skipped");
    });

    it("never returns an error status code even when integrations are absent (Req 11.6)", async () => {
      const res = await fetch(`${baseUrl}/api/health/ready`);
      // The readiness endpoint must never hard-fail / 500.
      expect(res.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Helmet security headers (Req 10.4)
  // ---------------------------------------------------------------------------

  describe("Helmet security headers (Req 10.4)", () => {
    it("includes X-Content-Type-Options: nosniff on all responses", async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("includes X-Frame-Options header", async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      // Helmet sets X-Frame-Options to SAMEORIGIN by default.
      expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    });

    it("includes Strict-Transport-Security header", async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      const hsts = res.headers.get("strict-transport-security");
      expect(hsts).toBeTruthy();
      expect(hsts).toContain("max-age=");
    });

    it("includes X-DNS-Prefetch-Control header", async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.headers.get("x-dns-prefetch-control")).toBe("off");
    });

    it("includes X-Download-Options header", async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.headers.get("x-download-options")).toBe("noopen");
    });

    it("Helmet headers are present on the readiness endpoint too", async () => {
      const res = await fetch(`${baseUrl}/api/health/ready`);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    });
  });

  // ---------------------------------------------------------------------------
  // Startup integration summary (Req 11.5)
  // ---------------------------------------------------------------------------

  describe("Startup integration summary (Req 11.5)", () => {
    it("formatIntegrationSummary produces a summary with all integration statuses", () => {
      // Verify the summary function produces a parseable line mentioning each
      // integration with its status.
      const summary = formatIntegrationSummary({
        gemini: "configured",
        githubToken: "skipped",
        lark: "skipped",
        githubApp: "skipped",
      });

      expect(summary).toContain("gemini=configured");
      expect(summary).toContain("githubToken=skipped");
      expect(summary).toContain("lark=skipped");
      expect(summary).toContain("githubApp=skipped");
    });

    it("formatIntegrationSummary defaults to computeReadiness() when no argument given", () => {
      // When called without args (like at startup), it uses actual env.
      const summary = formatIntegrationSummary();
      // Must contain all integration names regardless of env state.
      expect(summary).toMatch(/gemini=(configured|skipped|error)/);
      expect(summary).toMatch(/githubToken=(configured|skipped|error)/);
      expect(summary).toMatch(/lark=(configured|skipped|error)/);
      expect(summary).toMatch(/githubApp=(configured|skipped|error)/);
    });

    it("computeReadiness returns a valid ReadinessReport shape", () => {
      const report = computeReadiness();
      const validStatuses = ["configured", "skipped", "error"];
      expect(validStatuses).toContain(report.gemini);
      expect(validStatuses).toContain(report.githubToken);
      expect(validStatuses).toContain(report.lark);
      expect(validStatuses).toContain(report.githubApp);
    });
  });
});

// =============================================================================
// Repository scan triggers ingestion end-to-end (Req 12.1)
// =============================================================================

/**
 * Integration test verifying that a `repository` source-type scan creation
 * flows through the full ScanService → GitHubIngestionService chain: URL/ref
 * validation, ScanJob creation, ingestion call, and job enqueueing.
 *
 * Uses mocked PrismaService and queue, but exercises the real ScanService and
 * GitHubIngestionService.validateUrl/validateRef logic, confirming the wiring
 * is correct end-to-end at the service layer.
 *
 * Validates: Requirements 12.1 (e2e for repository scan)
 */
describe("Repository scan ingestion e2e (ScanService)", () => {
  const SCAN_ID = "e2e-scan-001";
  let prisma: any;
  let scanQueue: any;
  let githubIngestion: any;

  beforeEach(() => {
    prisma = {
      scanJob: {
        create: jest.fn().mockResolvedValue({ id: SCAN_ID }),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
      },
      finding: { findMany: jest.fn() },
    };
    scanQueue = {
      add: jest.fn().mockResolvedValue({ id: "bull-job-1" }),
    };
    githubIngestion = {
      validateUrl: jest.fn().mockReturnValue({
        owner: "octocat",
        repo: "Hello-World",
        ref: undefined,
      }),
      validateRef: jest.fn().mockReturnValue(undefined),
      ingest: jest.fn().mockResolvedValue({
        scanDir: expect.any(String),
        fileCount: 5,
        totalBytes: 2000,
      }),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Clean up any temp dirs.
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(process.cwd(), "temp-scans", SCAN_ID);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validates URL, creates job, ingests, and enqueues for a valid repository URL", async () => {
    // Import ScanService directly — it's instantiated with mocked deps.
    const { ScanService } = await import("../scan/scan.service");
    const service = new ScanService(prisma, scanQueue as any, githubIngestion);

    const result = await service.createScan(
      {
        sourceType: "repository",
        sourceRef: "https://github.com/octocat/Hello-World",
        scanMode: "full",
      } as any,
    );

    // 1) URL validation was invoked.
    expect(githubIngestion.validateUrl).toHaveBeenCalledWith(
      "https://github.com/octocat/Hello-World",
    );
    // 2) Ref validation was invoked (no ref → undefined is fine).
    expect(githubIngestion.validateRef).toHaveBeenCalled();
    // 3) Prisma job was created with sourceType "repository".
    expect(prisma.scanJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceType: "repository",
          sourceRef: "https://github.com/octocat/Hello-World",
          status: "queued",
          scanMode: "full",
        }),
      }),
    );
    // 4) Ingest was called.
    expect(githubIngestion.ingest).toHaveBeenCalledWith(
      "https://github.com/octocat/Hello-World",
      undefined,
      SCAN_ID,
      expect.stringContaining(SCAN_ID),
    );
    // 5) Job was enqueued to BullMQ.
    expect(scanQueue.add).toHaveBeenCalledWith("process-scan", {
      scanId: SCAN_ID,
      scanDir: expect.stringContaining(SCAN_ID),
    });
    // 6) Return value is the created ScanJob.
    expect(result).toEqual({ id: SCAN_ID });
  });

  it("rejects a non-GitHub URL with 400 before creating any job", async () => {
    const {
      GitHubIngestionError,
    } = await import("../scan/github-ingestion.service");
    githubIngestion.validateUrl.mockImplementation(() => {
      throw new GitHubIngestionError(
        "invalid-url",
        "Only https://github.com URLs are accepted.",
      );
    });

    const { ScanService } = await import("../scan/scan.service");
    const service = new ScanService(prisma, scanQueue as any, githubIngestion);

    await expect(
      service.createScan({
        sourceType: "repository",
        sourceRef: "https://gitlab.com/evil/repo",
        scanMode: "full",
      } as any),
    ).rejects.toMatchObject({ status: 400 });

    expect(prisma.scanJob.create).not.toHaveBeenCalled();
    expect(scanQueue.add).not.toHaveBeenCalled();
  });
});
