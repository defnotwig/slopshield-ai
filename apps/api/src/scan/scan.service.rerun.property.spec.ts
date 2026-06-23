// Feature: production-grade-system, Property 9: Rerun preserves source parameters
import "reflect-metadata";
import fc from "fast-check";
import * as fs from "node:fs";
import * as path from "node:path";
import { ScanService } from "./scan.service.js";

/**
 * Property 9: Rerun preserves source parameters
 *
 * For any existing ScanJob, activating rerun creates a new ScanJob with status
 * `queued`, a distinct id, and `sourceType`, `sourceRef`, `scanMode`, and
 * `projectId` equal to the original.
 *
 * Rerun is only supported for `repository` scans (other source types are not
 * retained), so the generator constrains `sourceType` to `repository` and
 * draws arbitrary valid `sourceRef`/`scanMode`/`projectId` values. We drive the
 * real {@link ScanService.rerunScan} with an in-memory Prisma double plus stub
 * queue/ingestion collaborators and assert the persisted new job preserves the
 * source parameters while getting a fresh id and `queued` status.
 *
 * Validates: Requirements 3.4, 3.5
 */

/** Valid scan modes accepted by the create-scan contract. */
const SCAN_MODE = fc.constantFrom(
  "full",
  "security-only",
  "frontend-only",
  "backend-only",
);

/** A plausible https github repository URL used as the stored sourceRef. */
const REPO_REF = fc
  .record({
    owner: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
    repo: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
  })
  .map(({ owner, repo }) => `https://github.com/${owner}/${repo}`);

/** An optional projectId (null models "no project"). */
const PROJECT_ID = fc.option(fc.stringMatching(/^proj-[a-z0-9]{1,12}$/), {
  nil: null,
});

const tempBaseDir = path.join(process.cwd(), "temp-scans");

describe("ScanService.rerunScan — Property 9: Rerun preserves source parameters", () => {
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

  it("creates a distinct queued job preserving sourceType/sourceRef/scanMode/projectId", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        REPO_REF,
        SCAN_MODE,
        PROJECT_ID,
        fc.option(fc.stringMatching(/^user-[a-z0-9]{1,8}$/), { nil: null }),
        async (originalId, sourceRef, scanMode, projectId, originalStarter) => {
          const original = {
            id: originalId,
            projectId,
            sourceType: "repository",
            sourceRef,
            scanMode,
            startedBy: originalStarter,
            status: "completed",
          };

          // Capture the data the service persists for the new ScanJob.
          let persisted: any = null;
          let newId = "";

          const prisma: any = {
            scanJob: {
              findUnique: jest.fn().mockResolvedValue(original),
              create: jest.fn().mockImplementation(({ data }: any) => {
                persisted = data;
                newId = `rerun-${originalId}`;
                return Promise.resolve({ id: newId, ...data });
              }),
              update: jest.fn().mockResolvedValue({}),
            },
          };
          const scanQueue: any = {
            add: jest.fn().mockResolvedValue(undefined),
          };
          const githubIngestion: any = {
            ingest: jest.fn().mockResolvedValue(undefined),
          };

          const service = new ScanService(prisma, scanQueue, githubIngestion);
          const result = await service.rerunScan(originalId, "rerun-actor");

          // Track the temp dir the service creates so we can clean it up.
          if (newId) createdScanDirs.push(path.join(tempBaseDir, newId));

          // A new ScanJob row was persisted.
          expect(persisted).not.toBeNull();

          // Source parameters are preserved exactly.
          expect(persisted.sourceType).toBe(original.sourceType);
          expect(persisted.sourceRef).toBe(original.sourceRef);
          expect(persisted.scanMode).toBe(original.scanMode);
          expect(persisted.projectId).toBe(original.projectId);

          // The new job is queued.
          expect(persisted.status).toBe("queued");

          // The new job has a distinct id from the original.
          expect(result.id).toBe(newId);
          expect(result.id).not.toBe(originalId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
