import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as tar from "tar";
import { ScanService } from "./scan.service.js";
import { GitHubIngestionService } from "./github-ingestion.service.js";
import type { GitHubIngestionConfig } from "./github-ingestion.config.js";
import type { CreateScanInput } from "@slopshield/shared";

/**
 * Unit tests for scan-mode scoping and the no-code-execution guarantee of
 * repository ingestion.
 *
 * Requirement 4.4: WHERE the request includes a Scan_Mode of `full`, `fast`,
 *                  `security-only`, `frontend-only`, or `backend-only`, THE API
 *                  SHALL scope the scan according to the selected Scan_Mode.
 * Requirement 4.9: THE GitHub_Ingestion_Service SHALL fetch and scan repository
 *                  contents WITHOUT executing any code contained in the
 *                  repository.
 *
 * The concrete, observable scoping the API performs for a Scan_Mode is:
 *   - the selected mode is validated/accepted and persisted onto the ScanJob,
 *   - the mode is propagated unchanged through createScan and rerunScan so the
 *     downstream pipeline scopes its passes accordingly, and
 *   - for `paste` sources the mode scopes the written source file type
 *     (`frontend-only` -> `.tsx`, every other mode -> `.ts`).
 *
 * No-code-execution is asserted two ways: a structural source-level assertion
 * that the ingestion code references no code-execution primitives, and a
 * functional sentinel proving `safeExtract` writes a hostile archive's files
 * to disk without ever running their lifecycle scripts.
 *
 * Validates: Requirements 4.4, 4.9
 */

/** All five Scan_Mode values defined by the shared ScanModeEnum. */
const ALL_MODES: CreateScanInput["scanMode"][] = [
  "full",
  "fast",
  "security-only",
  "frontend-only",
  "backend-only",
];

describe("Scan-mode scoping (Req 4.4)", () => {
  const tempBaseDir = path.join(process.cwd(), "temp-scans");
  let createdScanIds: string[] = [];

  let prisma: any;
  let scanQueue: any;
  let githubIngestion: any;

  const buildService = () =>
    new ScanService(prisma, scanQueue as any, githubIngestion);

  /** Make prisma.scanJob.create mint a fresh id per call so each test is isolated. */
  const installCreateIds = (prefix: string) => {
    let n = 0;
    prisma.scanJob.create.mockImplementation(async () => {
      const id = `${prefix}-${n++}`;
      createdScanIds.push(id);
      return { id };
    });
  };

  beforeEach(() => {
    createdScanIds = [];
    prisma = {
      scanJob: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
      },
    };
    scanQueue = { add: jest.fn().mockResolvedValue({ id: "job-1" }) };
    githubIngestion = {
      validateUrl: jest
        .fn()
        .mockReturnValue({ owner: "owner", repo: "repo", ref: undefined }),
      validateRef: jest.fn().mockReturnValue(undefined),
      ingest: jest.fn().mockResolvedValue({
        scanDir: "",
        fileCount: 1,
        totalBytes: 10,
      }),
    };
  });

  afterEach(() => {
    for (const id of createdScanIds) {
      const dir = path.join(tempBaseDir, id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    jest.clearAllMocks();
  });

  describe("repository scans persist and propagate the selected mode", () => {
    it.each(ALL_MODES)(
      "accepts scanMode '%s' and records it on the ScanJob",
      async (mode) => {
        installCreateIds(`repo-${mode}`);
        const service = buildService();
        const input: CreateScanInput = {
          sourceType: "repository",
          sourceRef: "https://github.com/owner/repo",
          scanMode: mode,
        } as CreateScanInput;

        await service.createScan(input);

        // The mode is persisted verbatim onto the ScanJob row — this is how the
        // pipeline learns the scope for this scan.
        expect(prisma.scanJob.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            sourceType: "repository",
            scanMode: mode,
            status: "queued",
          }),
        });
        // The scan is actually scoped/ingested and enqueued (not rejected).
        expect(githubIngestion.ingest).toHaveBeenCalledTimes(1);
        expect(scanQueue.add).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe("rerun preserves the original scan's mode (Req 4.4)", () => {
    it.each(ALL_MODES)(
      "re-runs a '%s' scan with the same mode",
      async (mode) => {
        installCreateIds(`rerun-${mode}`);
        prisma.scanJob.findUnique.mockResolvedValue({
          id: "original",
          projectId: null,
          sourceType: "repository",
          sourceRef: "https://github.com/owner/repo",
          scanMode: mode,
          startedBy: "user-1",
          status: "completed",
        });
        const service = buildService();

        await service.rerunScan("original", "user-2");

        expect(prisma.scanJob.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            sourceType: "repository",
            scanMode: mode,
            status: "queued",
          }),
        });
      },
    );
  });

  describe("paste scans scope the written source file type by mode", () => {
    it("writes a .tsx file for frontend-only mode", async () => {
      installCreateIds("paste-fe");
      const service = buildService();
      const input: CreateScanInput = {
        sourceType: "paste",
        sourceContent: "export const x = <div/>;",
        scanMode: "frontend-only",
      } as CreateScanInput;

      await service.createScan(input);

      const scanId = createdScanIds[0];
      const scanDir = path.join(tempBaseDir, scanId);
      expect(fs.existsSync(path.join(scanDir, "pasted_code.tsx"))).toBe(true);
      expect(fs.existsSync(path.join(scanDir, "pasted_code.ts"))).toBe(false);
      // Repository validation/ingestion never runs for paste scans.
      expect(githubIngestion.ingest).not.toHaveBeenCalled();
    });

    it.each(["full", "fast", "security-only", "backend-only"] as const)(
      "writes a .ts file for non-frontend mode '%s'",
      async (mode) => {
        installCreateIds(`paste-${mode}`);
        const service = buildService();
        const input: CreateScanInput = {
          sourceType: "paste",
          sourceContent: "export const x = 1;",
          scanMode: mode,
        } as CreateScanInput;

        await service.createScan(input);

        const scanId = createdScanIds[0];
        const scanDir = path.join(tempBaseDir, scanId);
        expect(fs.existsSync(path.join(scanDir, "pasted_code.ts"))).toBe(true);
        expect(fs.existsSync(path.join(scanDir, "pasted_code.tsx"))).toBe(
          false,
        );
      },
    );
  });
});

describe("Ingestion executes no repository code (Req 4.9)", () => {
  describe("structural: ingestion source references no code-execution primitives", () => {
    /** Code-execution primitives that must never appear in ingestion code. */
    const FORBIDDEN = [
      "child_process",
      "node:child_process",
      "execSync(",
      "exec(",
      "execFile(",
      "spawn(",
      "spawnSync(",
      "node:vm",
      'require("vm")',
      "eval(",
      "new Function(",
    ];

    it.each([
      "github-ingestion.service.ts",
      "scan.service.ts",
      "scan.processor.ts",
    ])("'%s' contains no shell/eval/vm execution APIs", (fileName) => {
      const source = fs.readFileSync(path.join(__dirname, fileName), "utf8");
      for (const primitive of FORBIDDEN) {
        expect(source).not.toContain(primitive);
      }
    });
  });

  describe("functional: safeExtract writes hostile files without running them", () => {
    const service = new GitHubIngestionService({
      maxRepoBytes: 100 * 1024 * 1024,
      maxFileCount: 5000,
      fetchTimeoutMs: 60_000,
      fetchMechanism: "tarball",
    } satisfies GitHubIngestionConfig);

    let tempDirs: string[] = [];
    const makeTempDir = (prefix: string): string => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
      tempDirs.push(dir);
      return dir;
    };

    afterEach(() => {
      for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      tempDirs = [];
    });

    it("never executes a repository's lifecycle scripts during extraction", async () => {
      // A unique sentinel a hostile script WOULD create if it were executed.
      const sentinel = path.join(
        os.tmpdir(),
        `SCANMODE_SENTINEL_${process.pid}_${Date.now()}`,
      );
      if (fs.existsSync(sentinel)) fs.rmSync(sentinel, { force: true });

      const hostilePackageJson = JSON.stringify({
        name: "hostile-repo",
        version: "1.0.0",
        scripts: {
          postinstall: `node -e "require('fs').writeFileSync(${JSON.stringify(
            sentinel,
          )}, 'pwned')"`,
        },
      });

      // Build a real gzipped tarball with a single GitHub-style top folder.
      const staging = makeTempDir("scanmode-staging-");
      const entries: Record<string, string> = {
        "repo-main/package.json": hostilePackageJson,
        "repo-main/evil.sh": `#!/bin/sh\necho pwned > ${JSON.stringify(
          sentinel,
        )}\n`,
        "repo-main/index.ts": "export const ok = true;\n",
      };
      for (const [rel, content] of Object.entries(entries)) {
        const full = path.join(staging, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
      }
      const tarStream = tar.create(
        { gzip: true, cwd: staging },
        Object.keys(entries),
      ) as unknown as NodeJS.ReadableStream;

      const scanDir = makeTempDir("scanmode-scan-");
      const result = await service.safeExtract(tarStream, scanDir);

      // The core guarantee: files are written to disk, never executed.
      expect(fs.existsSync(sentinel)).toBe(false);
      expect(fs.existsSync(path.join(scanDir, "package.json"))).toBe(true);
      expect(fs.existsSync(path.join(scanDir, "evil.sh"))).toBe(true);
      expect(fs.existsSync(path.join(scanDir, "index.ts"))).toBe(true);
      expect(result.fileCount).toBe(3);

      if (fs.existsSync(sentinel)) fs.rmSync(sentinel, { force: true });
    });
  });
});
