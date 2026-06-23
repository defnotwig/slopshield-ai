import { BadRequestException } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { ScanService } from "./scan.service.js";

/**
 * Unit tests for Scan_Directory cleanup on terminal / non-success states.
 *
 * Requirement 4.10:  WHEN a scan completes or fails, the Scan_Worker removes
 *                    the Scan_Directory and its temporary contents.
 * Requirement 4.10a: WHEN a scan ends in any intermediate or non-success
 *                    terminal state, including timeout or cancellation, the
 *                    Scan_Worker removes the Scan_Directory and its contents.
 *
 * These tests cover the cancellation path handled by ScanService.cancelScan.
 *
 * Validates: Requirements 4.10, 4.10a
 */
describe("ScanService cleanup on cancellation", () => {
  const SCAN_ID = "scan-cleanup-123";
  const tempBaseDir = path.join(process.cwd(), "temp-scans");
  const scanDir = path.join(tempBaseDir, SCAN_ID);

  let prisma: any;
  let scanQueue: any;
  let githubIngestion: any;

  const buildService = () =>
    new ScanService(prisma, scanQueue as any, githubIngestion);

  beforeEach(() => {
    prisma = {
      scanJob: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    scanQueue = { add: jest.fn() };
    githubIngestion = {};

    // Create a real Scan_Directory with temporary contents to be removed.
    fs.mkdirSync(scanDir, { recursive: true });
    fs.writeFileSync(path.join(scanDir, "pasted_code.ts"), "const x = 1;\n");
  });

  afterEach(() => {
    if (fs.existsSync(scanDir)) {
      fs.rmSync(scanDir, { recursive: true, force: true });
    }
    jest.clearAllMocks();
  });

  it("removes the Scan_Directory when a queued scan is cancelled", async () => {
    prisma.scanJob.findUnique.mockResolvedValue({
      id: SCAN_ID,
      status: "queued",
    });
    const service = buildService();

    expect(fs.existsSync(scanDir)).toBe(true);

    await service.cancelScan(SCAN_ID);

    // The scan was marked cancelled and the temp directory was removed.
    expect(prisma.scanJob.update).toHaveBeenCalledWith({
      where: { id: SCAN_ID },
      data: expect.objectContaining({ status: "cancelled" }),
    });
    expect(fs.existsSync(scanDir)).toBe(false);
  });

  it("does not remove the directory or update when scan is already terminal", async () => {
    prisma.scanJob.findUnique.mockResolvedValue({
      id: SCAN_ID,
      status: "completed",
    });
    const service = buildService();

    await expect(service.cancelScan(SCAN_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // No cancellation update and the directory is untouched by the guard path.
    expect(prisma.scanJob.update).not.toHaveBeenCalled();
    expect(fs.existsSync(scanDir)).toBe(true);
  });

  it("succeeds even when the Scan_Directory was already removed", async () => {
    prisma.scanJob.findUnique.mockResolvedValue({
      id: SCAN_ID,
      status: "queued",
    });
    fs.rmSync(scanDir, { recursive: true, force: true });
    const service = buildService();

    await expect(service.cancelScan(SCAN_ID)).resolves.toBeDefined();
    expect(prisma.scanJob.update).toHaveBeenCalledTimes(1);
  });
});
