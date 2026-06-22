import { BadRequestException } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { ScanService } from "./scan.service.js";
import { GitHubIngestionError } from "./github-ingestion.service.js";
import type { CreateScanInput } from "@slopshield/shared";

/**
 * Unit tests for the `repository` branch of ScanService.createScan.
 *
 * createScan runs the synchronous GitHub URL/ref validation (validateUrl +
 * validateRef) BEFORE creating a ScanJob, so invalid-input failures surface as
 * HTTP 400 and never create or enqueue a job. Fetch/extract failures happen
 * after the job is created and are recorded as a failed ScanJob with the temp
 * scanDir cleaned up.
 *
 * Validates: Requirements 1.2, 1.4, 1.5, 1.6, 11.5, 11.6
 */
describe("ScanService.createScan repository branch", () => {
  const SCAN_ID = "scan-123";
  const tempBaseDir = path.join(process.cwd(), "temp-scans");

  // Mocks rebuilt per test for isolation.
  let prisma: any;
  let scanQueue: any;
  let githubIngestion: any;

  const buildService = () =>
    new ScanService(prisma, scanQueue as any, githubIngestion);

  beforeEach(() => {
    prisma = {
      scanJob: {
        create: jest.fn().mockResolvedValue({ id: SCAN_ID }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    scanQueue = {
      add: jest.fn().mockResolvedValue({ id: "job-1" }),
    };
    // Default ingestion mock: validation passes, ingest succeeds.
    githubIngestion = {
      validateUrl: jest.fn().mockReturnValue({
        owner: "owner",
        repo: "repo",
        ref: undefined,
      }),
      validateRef: jest.fn().mockReturnValue(undefined),
      ingest: jest.fn().mockResolvedValue({
        scanDir: path.join(tempBaseDir, SCAN_ID),
        fileCount: 3,
        totalBytes: 100,
      }),
    };
  });

  afterEach(() => {
    // Remove any temp scan dir a test may have created.
    const scanDir = path.join(tempBaseDir, SCAN_ID);
    if (fs.existsSync(scanDir)) {
      fs.rmSync(scanDir, { recursive: true, force: true });
    }
    jest.clearAllMocks();
  });

  it("throws BadRequestException (400) when repository URL is missing", async () => {
    const service = buildService();
    const input: CreateScanInput = {
      sourceType: "repository",
      sourceRef: undefined,
      scanMode: "full",
    } as CreateScanInput;

    await expect(service.createScan(input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // No validation, job creation, or queueing should occur.
    expect(githubIngestion.validateUrl).not.toHaveBeenCalled();
    expect(prisma.scanJob.create).not.toHaveBeenCalled();
    expect(scanQueue.add).not.toHaveBeenCalled();
  });

  it("throws BadRequestException (400) on invalid-url and does NOT create/queue a ScanJob", async () => {
    githubIngestion.validateUrl.mockImplementation(() => {
      throw new GitHubIngestionError(
        "invalid-url",
        "The repository URL is invalid.",
      );
    });
    const service = buildService();
    const input: CreateScanInput = {
      sourceType: "repository",
      sourceRef: "not-a-url",
      scanMode: "full",
    } as CreateScanInput;

    await expect(service.createScan(input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.scanJob.create).not.toHaveBeenCalled();
    expect(githubIngestion.ingest).not.toHaveBeenCalled();
    expect(scanQueue.add).not.toHaveBeenCalled();
  });

  it("throws BadRequestException (400) on invalid-ref and does NOT create/queue a ScanJob", async () => {
    githubIngestion.validateUrl.mockReturnValue({
      owner: "owner",
      repo: "repo",
      ref: "bad ref",
    });
    githubIngestion.validateRef.mockImplementation(() => {
      throw new GitHubIngestionError(
        "invalid-ref",
        'Invalid git ref: "bad ref".',
      );
    });
    const service = buildService();
    const input: CreateScanInput = {
      sourceType: "repository",
      sourceRef: "https://github.com/owner/repo/tree/bad ref",
      scanMode: "full",
    } as CreateScanInput;

    await expect(service.createScan(input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.scanJob.create).not.toHaveBeenCalled();
    expect(githubIngestion.ingest).not.toHaveBeenCalled();
    expect(scanQueue.add).not.toHaveBeenCalled();
  });

  it("enqueues process-scan with { scanId, scanDir } on successful ingest", async () => {
    const service = buildService();
    const input: CreateScanInput = {
      sourceType: "repository",
      sourceRef: "https://github.com/owner/repo",
      scanMode: "full",
    } as CreateScanInput;

    const result = await service.createScan(input);

    expect(result).toEqual({ id: SCAN_ID });
    expect(prisma.scanJob.create).toHaveBeenCalledTimes(1);
    expect(githubIngestion.ingest).toHaveBeenCalledTimes(1);

    const expectedScanDir = path.join(tempBaseDir, SCAN_ID);
    expect(scanQueue.add).toHaveBeenCalledWith("process-scan", {
      scanId: SCAN_ID,
      scanDir: expectedScanDir,
    });
    // Success path does not mark the job failed.
    expect(prisma.scanJob.update).not.toHaveBeenCalled();
  });

  it("marks ScanJob failed with a failureReason and cleans up scanDir on ingest fetch/extract failure", async () => {
    githubIngestion.ingest.mockRejectedValue(
      new GitHubIngestionError("not-found", "Repository or ref not found."),
    );
    const service = buildService();
    const input: CreateScanInput = {
      sourceType: "repository",
      sourceRef: "https://github.com/owner/repo",
      scanMode: "full",
    } as CreateScanInput;

    await expect(service.createScan(input)).rejects.toBeInstanceOf(
      GitHubIngestionError,
    );

    // Job was created, then marked failed with a reason.
    expect(prisma.scanJob.create).toHaveBeenCalledTimes(1);
    expect(prisma.scanJob.update).toHaveBeenCalledTimes(1);
    const updateArg = prisma.scanJob.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: SCAN_ID });
    expect(updateArg.data.status).toBe("failed");
    expect(updateArg.data.failureReason).toBeTruthy();
    expect(updateArg.data.failureReason).toBe("Repository or ref not found.");

    // Never enqueued, and the temp scanDir was removed.
    expect(scanQueue.add).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tempBaseDir, SCAN_ID))).toBe(false);
  });

  it("leaves the paste branch unchanged (smoke: a paste scan still enqueues)", async () => {
    const service = buildService();
    const input: CreateScanInput = {
      sourceType: "paste",
      sourceContent: "const x = 1;",
      scanMode: "full",
    } as CreateScanInput;

    const result = await service.createScan(input);

    expect(result).toEqual({ id: SCAN_ID });
    // Repository validation must not run for paste scans.
    expect(githubIngestion.validateUrl).not.toHaveBeenCalled();
    expect(githubIngestion.ingest).not.toHaveBeenCalled();
    expect(scanQueue.add).toHaveBeenCalledWith("process-scan", {
      scanId: SCAN_ID,
      scanDir: path.join(tempBaseDir, SCAN_ID),
    });
  });
});
