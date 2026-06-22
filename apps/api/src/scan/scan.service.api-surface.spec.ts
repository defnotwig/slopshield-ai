/**
 * Scan API surface tests for repository scans.
 *
 * A repository scan must be observable through the standard scan read APIs:
 *  - getScan(id) returns the full ScanJob with sourceType="repository",
 *    sourceRef=<URL>, status, statusResult, failureReason, scores and findings
 *    passed through from the persistence layer unchanged.
 *  - listScans(...) returns repository scans carrying sourceType / sourceRef /
 *    failureReason so they appear in GET /scans alongside other sources.
 *  - A failed ingestion exposes status="failed" + a failureReason via getScan.
 *
 * ScanService is constructed directly with a mocked PrismaService, a mock
 * scan queue, and a mock GitHubIngestionService so the read paths can be
 * exercised in isolation.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 11.6
 */
import { NotFoundException } from "@nestjs/common";
import { ScanService } from "./scan.service.js";

function buildService(prismaOverrides: any) {
  const prisma: any = {
    scanJob: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      ...prismaOverrides?.scanJob,
    },
    finding: {
      findMany: jest.fn(),
      ...prismaOverrides?.finding,
    },
  };
  const scanQueue: any = { add: jest.fn() };
  const githubIngestion: any = {
    validateUrl: jest.fn(),
    validateRef: jest.fn(),
    ingest: jest.fn(),
  };

  const service = new ScanService(prisma, scanQueue, githubIngestion);
  return { service, prisma, scanQueue, githubIngestion };
}

describe("ScanService repository scan API surface", () => {
  describe("getScan", () => {
    it("returns a repository scan with sourceType/sourceRef and scores/findings intact", async () => {
      const repoUrl = "https://github.com/o/r";
      const row = {
        id: "scan-1",
        sourceType: "repository",
        sourceRef: repoUrl,
        status: "completed",
        statusResult: "passed-with-warnings",
        failureReason: null,
        overallScore: 82,
        securityScore: 90,
        findings: [
          {
            id: "f1",
            scanJobId: "scan-1",
            severity: "medium",
            category: "maintainability",
            title: "Example finding",
          },
        ],
      };
      const { service, prisma } = buildService({
        scanJob: { findUnique: jest.fn().mockResolvedValue(row) },
      });

      const result = await service.getScan("scan-1");

      expect(prisma.scanJob.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "scan-1" } }),
      );
      expect(result.sourceType).toBe("repository");
      expect(result.sourceRef).toBe(repoUrl);
      expect(result.status).toBe("completed");
      expect(result.statusResult).toBe("passed-with-warnings");
      expect(result.overallScore).toBe(82);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].title).toBe("Example finding");
    });

    it("exposes status=failed + failureReason for a failed ingestion", async () => {
      const row = {
        id: "scan-2",
        sourceType: "repository",
        sourceRef: "https://github.com/o/r",
        status: "failed",
        statusResult: "blocked",
        failureReason: "Repository or ref not found",
        overallScore: null,
        findings: [],
      };
      const { service } = buildService({
        scanJob: { findUnique: jest.fn().mockResolvedValue(row) },
      });

      const result = await service.getScan("scan-2");

      expect(result.status).toBe("failed");
      expect(result.failureReason).toBe("Repository or ref not found");
      expect(result.sourceType).toBe("repository");
      expect(result.sourceRef).toBe("https://github.com/o/r");
      expect(result.overallScore).toBeNull();
      expect(result.findings).toEqual([]);
    });

    it("throws NotFoundException when the scan does not exist", async () => {
      const { service } = buildService({
        scanJob: { findUnique: jest.fn().mockResolvedValue(null) },
      });

      await expect(service.getScan("missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("listScans", () => {
    it("returns repository scans carrying sourceType/sourceRef/failureReason", async () => {
      const items = [
        {
          id: "scan-3",
          sourceType: "repository",
          sourceRef: "https://github.com/o/r",
          status: "failed",
          statusResult: "blocked",
          failureReason: "Repository too large",
          overallScore: null,
        },
        {
          id: "scan-4",
          sourceType: "paste",
          sourceRef: null,
          status: "completed",
          statusResult: "passed",
          failureReason: null,
          overallScore: 100,
        },
      ];
      const { service, prisma } = buildService({
        scanJob: {
          findMany: jest.fn().mockResolvedValue(items),
          count: jest.fn().mockResolvedValue(2),
        },
      });

      const result = await service.listScans(1, 10);

      expect(prisma.scanJob.findMany).toHaveBeenCalled();
      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);

      const repoItem = result.items.find(
        (i: any) => i.sourceType === "repository",
      );
      expect(repoItem).toBeDefined();
      expect(repoItem.sourceRef).toBe("https://github.com/o/r");
      expect(repoItem.failureReason).toBe("Repository too large");
      expect(repoItem.status).toBe("failed");
    });

    it("passes the status filter through to prisma when provided", async () => {
      const { service, prisma } = buildService({
        scanJob: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
      });

      await service.listScans(1, 10, undefined, "failed");

      expect(prisma.scanJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: "failed" } }),
      );
    });
  });
});
