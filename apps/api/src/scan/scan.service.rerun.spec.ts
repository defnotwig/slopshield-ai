import { BadRequestException, NotFoundException } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { ScanService } from "./scan.service.js";

/**
 * Unit tests for the rerun endpoint (audit B7).
 *
 * Requirement 3.4: WHEN a user activates the rerun action on a completed scan
 *                  report, THE Web_App SHALL call a real API rerun endpoint.
 * Requirement 3.5: WHEN a rerun request is received for an existing scan, THE
 *                  API SHALL create a new queued ScanJob that references the
 *                  same source parameters as the original scan.
 *
 * Validates: Requirements 3.4, 3.5
 */
describe("ScanService.rerunScan", () => {
  const ORIGINAL_ID = "scan-original-1";
  const NEW_ID = "scan-rerun-2";
  const tempBaseDir = path.join(process.cwd(), "temp-scans");
  const newScanDir = path.join(tempBaseDir, NEW_ID);

  let prisma: any;
  let scanQueue: any;
  let githubIngestion: any;

  const buildService = () =>
    new ScanService(prisma, scanQueue as any, githubIngestion);

  beforeEach(() => {
    prisma = {
      scanJob: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    scanQueue = { add: jest.fn().mockResolvedValue(undefined) };
    githubIngestion = {
      ingest: jest.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    if (fs.existsSync(newScanDir)) {
      fs.rmSync(newScanDir, { recursive: true, force: true });
    }
    jest.clearAllMocks();
  });

  it("creates a new queued ScanJob preserving the original source parameters", async () => {
    prisma.scanJob.findUnique.mockResolvedValue({
      id: ORIGINAL_ID,
      projectId: "proj-9",
      sourceType: "repository",
      sourceRef: "https://github.com/acme/widget",
      scanMode: "security-only",
      startedBy: "user-1",
      status: "completed",
    });
    prisma.scanJob.create.mockResolvedValue({
      id: NEW_ID,
      sourceType: "repository",
    });

    const service = buildService();
    const result = await service.rerunScan(ORIGINAL_ID, "user-2");

    // A new ScanJob is created with status "queued" and the same source params.
    expect(prisma.scanJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "proj-9",
        sourceType: "repository",
        sourceRef: "https://github.com/acme/widget",
        scanMode: "security-only",
        status: "queued",
      }),
    });
    // The new job is re-ingested and enqueued.
    expect(githubIngestion.ingest).toHaveBeenCalledWith(
      "https://github.com/acme/widget",
      undefined,
      NEW_ID,
      newScanDir,
    );
    expect(scanQueue.add).toHaveBeenCalledWith("process-scan", {
      scanId: NEW_ID,
      scanDir: newScanDir,
    });
    expect(result.id).toBe(NEW_ID);
  });

  it("throws NotFoundException when the original scan does not exist", async () => {
    prisma.scanJob.findUnique.mockResolvedValue(null);
    const service = buildService();

    await expect(service.rerunScan("missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.scanJob.create).not.toHaveBeenCalled();
  });

  it("rejects rerun for non-repository sources whose content is not retained", async () => {
    prisma.scanJob.findUnique.mockResolvedValue({
      id: ORIGINAL_ID,
      sourceType: "paste",
      sourceRef: null,
      scanMode: "full",
      status: "completed",
    });
    const service = buildService();

    await expect(service.rerunScan(ORIGINAL_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.scanJob.create).not.toHaveBeenCalled();
  });

  it("rejects rerun of a repository scan missing its stored URL", async () => {
    prisma.scanJob.findUnique.mockResolvedValue({
      id: ORIGINAL_ID,
      sourceType: "repository",
      sourceRef: null,
      scanMode: "full",
      status: "completed",
    });
    const service = buildService();

    await expect(service.rerunScan(ORIGINAL_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.scanJob.create).not.toHaveBeenCalled();
  });
});
