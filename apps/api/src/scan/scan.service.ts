import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateScanInput } from "@slopshield/shared";
import {
  GitHubIngestionService,
  GitHubIngestionError,
} from "./github-ingestion.service.js";
import { loadGitHubIngestionConfig } from "./github-ingestion.config.js";

/**
 * A single normalized archive entry, abstracting over both GitHub tarball
 * entries and uploaded-ZIP entries so they can share one extraction guard.
 */
export interface ArchiveEntry {
  /** Entry path as declared inside the archive (may contain `../`, be absolute, use either separator). */
  path: string;
  /** Entry kind. Only `"file"` is written; links are rejected outright. */
  type: "file" | "directory" | "symlink" | "link";
  /** File contents (for `"file"` entries). */
  data?: Buffer;
  /** Declared/decompressed size in bytes, used for the cumulative max-bytes cap. */
  size?: number;
  /** Link target for `"symlink"`/`"link"` entries. */
  linkname?: string;
}

/** Resource and safety limits enforced by {@link safeExtractArchive}. */
export interface SafeExtractLimits {
  /** Maximum number of regular files written. */
  maxFileCount: number;
  /** Maximum cumulative bytes written across all files. */
  maxBytes: number;
}

/** Discriminated reasons {@link safeExtractArchive} fails the entire scan. */
export type ArchiveExtractionErrorKind =
  | "path-escape" // entry resolves outside the Scan_Directory (Req 4.8, 4.8a)
  | "symlink" // symlink / hard-link entry (escape vector) rejected (Req 4.8a)
  | "too-many-files" // exceeded maxFileCount (Req 4.6)
  | "too-large"; // exceeded maxBytes (Req 4.6)

/**
 * Error thrown by {@link safeExtractArchive} when an archive entry violates a
 * confinement or resource rule. Any such violation fails the entire scan
 * immediately rather than skipping the offending entry (Req 4.8a).
 */
export class ArchiveExtractionError extends Error {
  constructor(
    public readonly kind: ArchiveExtractionErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ArchiveExtractionError";
  }
}

/** Result of a successful {@link safeExtractArchive} run. */
export interface SafeExtractResult {
  fileCount: number;
  totalBytes: number;
}

/**
 * Shared safe-extraction guard for archive entries (GitHub tarball or uploaded
 * ZIP). For every entry it enforces, in order:
 *
 *  - **Symlink rejection** — symlink / hard-link entries are an escape vector
 *    and fail the entire scan (Req 4.8a).
 *  - **Path confinement** — the entry's resolved destination MUST stay within
 *    `scanDir`; `../` sequences and absolute paths that escape fail the entire
 *    scan immediately and the offending entry is never written (Req 4.8, 4.8a).
 *  - **max-file-count / max-bytes** — cumulative caps that fail the scan when
 *    exceeded (Req 4.6).
 *
 * Only regular `"file"` entries are written; directories are created implicitly.
 * On any violation the function throws an {@link ArchiveExtractionError} and
 * never writes the offending entry outside `scanDir`.
 */
export function safeExtractArchive(
  entries: ArchiveEntry[],
  scanDir: string,
  limits: SafeExtractLimits,
): SafeExtractResult {
  const resolvedRoot = path.resolve(scanDir);
  let fileCount = 0;
  let totalBytes = 0;

  for (const entry of entries) {
    // 1) Reject links outright — a link could redirect a later write outside
    //    scanDir, so treat any link entry as a fatal escape (Req 4.8a).
    if (entry.type === "symlink" || entry.type === "link") {
      throw new ArchiveExtractionError(
        "symlink",
        `Archive entry "${entry.path}" is a link, which is not allowed.`,
      );
    }

    // 2) Path-confinement guard: the resolved destination must equal the root
    //    or sit beneath "root + sep". Rejects "../" escapes and absolute paths.
    const dest = path.resolve(resolvedRoot, entry.path);
    const contained =
      dest === resolvedRoot || dest.startsWith(resolvedRoot + path.sep);
    if (!contained) {
      throw new ArchiveExtractionError(
        "path-escape",
        `Archive entry "${entry.path}" resolves outside the scan directory.`,
      );
    }

    if (entry.type !== "file") {
      // Directories (and anything non-file/non-link) need no content write.
      continue;
    }

    // 3) Resource caps (Req 4.6).
    if (fileCount + 1 > limits.maxFileCount) {
      throw new ArchiveExtractionError(
        "too-many-files",
        "Archive exceeds the maximum allowed file count.",
      );
    }
    const size = entry.size ?? entry.data?.length ?? 0;
    if (totalBytes + size > limits.maxBytes) {
      throw new ArchiveExtractionError(
        "too-large",
        "Archive exceeds the maximum allowed total size.",
      );
    }

    // 4) Confinement verified — safe to write.
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.data ?? Buffer.alloc(0));
    fileCount += 1;
    totalBytes += size;
  }

  return { fileCount, totalBytes };
}

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);
  private readonly tempBaseDir: string;
  /**
   * Resource limits applied when extracting an uploaded ZIP through
   * {@link safeExtractArchive}. Sourced from the same environment-backed
   * ingestion config as the GitHub tarball path so both share one set of caps.
   */
  private readonly extractLimits: SafeExtractLimits;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("scan-pipeline") private readonly scanQueue: Queue,
    private readonly githubIngestion: GitHubIngestionService,
  ) {
    this.tempBaseDir = path.join(process.cwd(), "temp-scans");
    if (!fs.existsSync(this.tempBaseDir)) {
      fs.mkdirSync(this.tempBaseDir, { recursive: true });
    }
    const ingestionConfig = loadGitHubIngestionConfig();
    this.extractLimits = {
      maxFileCount: ingestionConfig.maxFileCount,
      maxBytes: ingestionConfig.maxRepoBytes,
    };
  }

  public async createScan(
    input: CreateScanInput,
    userId?: string,
    file?: Express.Multer.File,
  ): Promise<any> {
    if (input.sourceType === "paste" && !input.sourceContent) {
      throw new BadRequestException(
        'Pasted code content is required for sourceType: "paste"',
      );
    }
    if (input.sourceType === "upload" && !file) {
      throw new BadRequestException(
        'ZIP file upload is required for sourceType: "upload"',
      );
    }
    if (input.sourceType === "demo-sample" && !input.demoSampleId) {
      throw new BadRequestException(
        'Demo sample ID is required for sourceType: "demo-sample"',
      );
    }
    if (input.sourceType === "repository" && !input.sourceRef) {
      throw new BadRequestException(
        'A repository URL is required for sourceType: "repository"',
      );
    }

    // For repository scans, run the synchronous URL/ref validation up-front so
    // that invalid-input failures surface as HTTP 400 *before* a ScanJob row is
    // created or queued (Req 1.2, 2.x, 11.1). Fetch/extract failures are handled
    // later as a failed ScanJob.
    if (input.sourceType === "repository") {
      try {
        const parsed = this.githubIngestion.validateUrl(input.sourceRef!);
        // CreateScanInput carries no explicit ref field; the ref (if any) is
        // embedded in the URL path (/tree/<ref>) and parsed by validateUrl.
        this.githubIngestion.validateRef(parsed.ref);
      } catch (err) {
        if (
          err instanceof GitHubIngestionError &&
          (err.kind === "invalid-url" ||
            err.kind === "not-a-repo-url" ||
            err.kind === "invalid-ref")
        ) {
          throw new BadRequestException(err.message);
        }
        throw err;
      }
    }

    const scanJob = await this.prisma.scanJob.create({
      data: {
        projectId: input.projectId || null,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef || (file ? file.originalname : null),
        status: "queued",
        scanMode: input.scanMode || "full",
        startedBy: userId || null,
      },
    });

    return this.prepareAndEnqueue(scanJob, input, file);
  }

  /**
   * Re-run an existing scan (Req 3.4, 3.5, audit B7). Loads the original
   * ScanJob, creates a brand-new `queued` ScanJob referencing the same source
   * parameters (`sourceType`/`sourceRef`/`scanMode`/`projectId`), re-ingests
   * the source, enqueues the pipeline, and returns the new job.
   *
   * The original job's content (pasted code, uploaded ZIP buffer, demo-sample
   * id) is not retained after its scan completes, so rerun is supported only
   * for sources that can be re-fetched from their `sourceRef` — i.e.
   * `repository` scans. Other source types cannot be reproduced and are
   * rejected with a 400 explaining why.
   */
  public async rerunScan(id: string, userId?: string): Promise<any> {
    const original = await this.prisma.scanJob.findUnique({ where: { id } });
    if (!original) {
      throw new NotFoundException(`Scan job with ID ${id} not found`);
    }

    if (original.sourceType !== "repository") {
      throw new BadRequestException(
        `Rerun is only supported for repository scans; the original scan used sourceType "${original.sourceType}", whose source content is not retained after the scan completes.`,
      );
    }
    if (!original.sourceRef) {
      throw new BadRequestException(
        "Cannot rerun a repository scan without a stored repository URL.",
      );
    }

    const input: CreateScanInput = {
      projectId: original.projectId || undefined,
      sourceType: original.sourceType as CreateScanInput["sourceType"],
      sourceRef: original.sourceRef,
      scanMode: (original.scanMode || "full") as CreateScanInput["scanMode"],
    };

    const scanJob = await this.prisma.scanJob.create({
      data: {
        projectId: original.projectId,
        sourceType: original.sourceType,
        sourceRef: original.sourceRef,
        status: "queued",
        scanMode: original.scanMode || "full",
        startedBy: userId || original.startedBy || null,
      },
    });

    this.logger.log(`Rerunning scan ${id} as new scan ${scanJob.id}`);
    return this.prepareAndEnqueue(scanJob, input);
  }

  /**
   * Shared ingestion + enqueue path used by both {@link createScan} and
   * {@link rerunScan}. Prepares the per-scan temporary directory for the given
   * source type, enqueues the BullMQ pipeline job, and returns the ScanJob.
   * On ingestion failure the job is marked `failed`, its directory removed,
   * and the error mapped to a meaningful HTTP status.
   */
  private async prepareAndEnqueue(
    scanJob: { id: string },
    input: CreateScanInput,
    file?: Express.Multer.File,
  ): Promise<any> {
    const scanDir = path.join(this.tempBaseDir, scanJob.id);
    fs.mkdirSync(scanDir, { recursive: true });

    // Prepare files in scan directory
    try {
      if (input.sourceType === "paste") {
        const ext = input.scanMode === "frontend-only" ? ".tsx" : ".ts";
        const targetFile = path.join(scanDir, `pasted_code${ext}`);
        fs.writeFileSync(targetFile, input.sourceContent || "", "utf8");
      } else if (input.sourceType === "upload" && file) {
        // Route the uploaded ZIP through the shared safe-extraction guard
        // instead of AdmZip's unguarded extractAllTo, so the upload path gets
        // the same per-entry path-confinement, symlink rejection, max-file-count
        // and max-bytes protection as the GitHub tarball path (Req 4.7, 4.8,
        // 4.8a, 4.11 — resolves audit B3). Any escaping entry fails the scan.
        const entries = this.zipToArchiveEntries(file.buffer);
        safeExtractArchive(entries, scanDir, this.extractLimits);
      } else if (input.sourceType === "demo-sample") {
        const demoId = input.demoSampleId || "";
        const demoDir = this.resolveDemoSampleDir(demoId);
        this.copyFolderSync(demoDir, scanDir);
      } else if (input.sourceType === "repository") {
        // Fetch + extract the repository tarball into scanDir. Synchronous
        // validation already ran up-front; here only fetch/extract failures
        // (not-found, private-no-token, too-large, too-many-files, timeout,
        // network-error) can occur, and they mark the ScanJob as failed.
        // The explicit ref arg is undefined: CreateScanInput has no separate
        // ref field, so the ref is taken from the URL path by the ingest service.
        await this.githubIngestion.ingest(
          input.sourceRef!,
          undefined,
          scanJob.id,
          scanDir,
        );
      }

      // Add to BullMQ queue
      await this.scanQueue.add("process-scan", {
        scanId: scanJob.id,
        scanDir,
      });

      this.logger.log(`Enqueued scan job: ${scanJob.id}`);
      return scanJob;
    } catch (err: any) {
      this.logger.error(
        `Failed to ingest files for scan ${scanJob.id}: ${err.message}`,
      );
      await this.prisma.scanJob.update({
        where: { id: scanJob.id },
        data: {
          status: "failed",
          statusResult: "blocked",
          failureReason: err?.message ?? "Scan ingestion failed",
        },
      });
      // Clean up directory if created (ingest may have already removed it).
      this.removeScanDir(scanJob.id);
      // Map ingestion failures to meaningful HTTP statuses instead of a bare
      // 500. Client-correctable problems (bad repo, private without a token)
      // become 4xx; transient transport/size problems become 400 so the user
      // can retry or pick a smaller repo.
      if (err instanceof GitHubIngestionError) {
        throw this.toHttpException(err);
      }
      throw err;
    }
  }

  /** Translate a {@link GitHubIngestionError} into the right HTTP exception. */
  private toHttpException(
    err: GitHubIngestionError,
  ): NotFoundException | BadRequestException {
    switch (err.kind) {
      case "not-found":
        return new NotFoundException(err.message);
      case "private-no-token":
        // No public access and no token configured — treat as not found so we
        // do not leak whether a private repo exists.
        return new NotFoundException(err.message);
      case "invalid-url":
      case "not-a-repo-url":
      case "invalid-ref":
      case "too-large":
      case "too-many-files":
      case "timeout":
      case "network-error":
      default:
        return new BadRequestException(err.message);
    }
  }

  public async getScan(id: string): Promise<any> {
    const scan = await this.prisma.scanJob.findUnique({
      where: { id },
      include: {
        project: true,
        findings: true,
        scanFiles: true,
        metrics: true,
      },
    });

    if (!scan) {
      throw new NotFoundException(`Scan job with ID ${id} not found`);
    }

    return scan;
  }

  /** Per-scan performance/telemetry record (timings, file/finding counts, AI tokens). */
  public async getScanMetrics(id: string): Promise<any> {
    const scan = await this.prisma.scanJob.findUnique({
      where: { id },
      select: { id: true, analyzerCoverage: true, metrics: true },
    });
    if (!scan) {
      throw new NotFoundException(`Scan job with ID ${id} not found`);
    }
    return {
      scanId: scan.id,
      metrics: scan.metrics ?? null,
      analyzerCoverage: scan.analyzerCoverage ?? [],
    };
  }

  /**
   * Aggregate scanner telemetry across the most recent completed scans: average
   * stage durations, average AI token usage, and totals. Powers the admin
   * observability view and trend monitoring.
   */
  public async getAggregateMetrics(limit = 200): Promise<any> {
    const rows = await this.prisma.scanMetrics.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const n = rows.length;
    if (n === 0) {
      return { sampleSize: 0, averages: {}, totals: {} };
    }

    const sum = (key: keyof (typeof rows)[number]): number =>
      rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
    const avg = (key: keyof (typeof rows)[number]): number =>
      Math.round(sum(key) / n);

    return {
      sampleSize: n,
      averages: {
        queueWaitMs: avg("queueWaitMs"),
        fetchMs: avg("fetchMs"),
        classifyMs: avg("classifyMs"),
        staticAnalysisMs: avg("staticAnalysisMs"),
        aiReviewMs: avg("aiReviewMs"),
        scoringMs: avg("scoringMs"),
        totalMs: avg("totalMs"),
        analyzedFiles: avg("analyzedFiles"),
        staticFindingCount: avg("staticFindingCount"),
        aiFindingCount: avg("aiFindingCount"),
      },
      totals: {
        scans: n,
        aiInputTokens: sum("aiInputTokens"),
        aiOutputTokens: sum("aiOutputTokens"),
      },
    };
  }

  public async listScans(
    page = 1,
    limit = 10,
    projectId?: string,
    status?: string,
  ): Promise<any> {
    const filter: any = {};
    if (projectId) filter.projectId = projectId;
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.scanJob.findMany({
        where: filter,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: { project: true },
      }),
      this.prisma.scanJob.count({ where: filter }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  public async getFindings(
    scanId: string,
    category?: string,
    severity?: string,
    falsePositive?: boolean,
  ): Promise<any[]> {
    const filter: any = { scanJobId: scanId };
    if (category) filter.category = category;
    if (severity) filter.severity = severity;
    if (falsePositive !== undefined) filter.falsePositive = falsePositive;

    return this.prisma.finding.findMany({
      where: filter,
      orderBy: { severity: "asc" },
    });
  }

  public async cancelScan(id: string): Promise<any> {
    const scan = await this.getScan(id);
    if (
      scan.status === "completed" ||
      scan.status === "failed" ||
      scan.status === "cancelled"
    ) {
      throw new BadRequestException(
        `Cannot cancel a scan job that is already ${scan.status}`,
      );
    }

    const updated = await this.prisma.scanJob.update({
      where: { id },
      data: { status: "cancelled", completedAt: new Date() },
    });

    // Req 4.10a: a cancellation is a non-success terminal state, so remove the
    // Scan_Directory and its temporary contents. The worker's finally block
    // also cleans up if it is mid-flight; this guarantees removal when the job
    // is cancelled before or after the worker has run.
    this.removeScanDir(id);

    return updated;
  }

  /**
   * Best-effort removal of a scan's temporary Scan_Directory
   * (`temp-scans/{scanId}`). Cleanup failures are logged, never thrown, so they
   * cannot mask the scan's terminal outcome (Req 4.10, 4.10a).
   */
  private removeScanDir(scanId: string): void {
    const scanDir = path.join(this.tempBaseDir, scanId);
    if (!fs.existsSync(scanDir)) {
      return;
    }
    try {
      fs.rmSync(scanDir, { recursive: true, force: true });
    } catch (cleanupErr: any) {
      this.logger.warn(
        `Failed to remove scan directory ${scanDir}: ${cleanupErr?.message ?? cleanupErr}`,
      );
    }
  }

  /**
   * Normalize an uploaded ZIP buffer into {@link ArchiveEntry}s so it can be
   * written through the shared {@link safeExtractArchive} guard. Symlink entries
   * are detected from the Unix mode bits in the external file attributes and
   * marked `"symlink"` so the guard rejects them outright (Req 4.8a).
   */
  private zipToArchiveEntries(buffer: Buffer): ArchiveEntry[] {
    const zip = new AdmZip(buffer);
    return zip.getEntries().map((zipEntry): ArchiveEntry => {
      // adm-zip exposes a Unix symlink via the high bits of the external file
      // attributes (S_IFLNK = 0xA000).
      const unixMode = (zipEntry.header.attr ?? 0) >>> 16;
      const isSymlink = (unixMode & 0xf000) === 0xa000;
      let type: ArchiveEntry["type"];
      if (isSymlink) {
        type = "symlink";
      } else if (zipEntry.isDirectory) {
        type = "directory";
      } else {
        type = "file";
      }
      return {
        path: zipEntry.entryName,
        type,
        data: zipEntry.isDirectory ? undefined : zipEntry.getData(),
        size: zipEntry.header.size,
      };
    });
  }

  /**
   * Resolve the demo samples directory for a given demo ID. Tries multiple
   * candidate paths to support both production (dist output) and development
   * (monorepo root or apps/api directly) environments.
   *
   * @throws BadRequestException if none of the candidate paths exist.
   */
  private resolveDemoSampleDir(demoId: string): string {
    const candidates = [
      // 1. Relative to compiled dist output (production)
      path.join(__dirname, "../../demo-samples", demoId),
      // 2. Monorepo root with apps/api prefix (dev or production at repo root)
      path.join(process.cwd(), "apps/api/demo-samples", demoId),
      // 3. Run directly from apps/api directory
      path.join(process.cwd(), "demo-samples", demoId),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new BadRequestException(
      `Demo sample folder ${demoId} not found`,
    );
  }

  private copyFolderSync(from: string, to: string): void {
    if (!fs.existsSync(to)) {
      fs.mkdirSync(to, { recursive: true });
    }
    const elements = fs.readdirSync(from);
    for (const element of elements) {
      const fromPath = path.join(from, element);
      const toPath = path.join(to, element);
      const stats = fs.statSync(fromPath);
      if (stats.isDirectory()) {
        this.copyFolderSync(fromPath, toPath);
      } else {
        fs.copyFileSync(fromPath, toPath);
      }
    }
  }
}
