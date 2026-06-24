import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Job } from "bullmq";
import * as fs from "fs";
import * as path from "path";
import { PrismaService } from "../prisma/prisma.service.js";
import { ScanGateway } from "./scan.gateway.js";
import { FileClassifier } from "@slopshield/scanner-plugins";
import { ScannerOrchestrator } from "../scanner/scanner.orchestrator.js";
import { AIReviewerService } from "../ai-reviewer/ai-reviewer.service.js";
import { ScoringService } from "../scoring/scoring.service.js";
import { ReportService } from "../report/report.service.js";
import { LarkService } from "../lark/lark.service.js";
import { NotificationService } from "../notification/notification.service.js";
import { capFiles, maxAnalyzeFiles } from "../common/env.js";
import {
  analyzersForMode,
  shouldRunAiForMode,
  fileMatchesMode,
} from "../scanner/scan-mode.util.js";
import { CustomRule, CustomRuleListSchema } from "@slopshield/shared";

@Processor("scan-pipeline", { concurrency: 1 })
export class ScanProcessor extends WorkerHost {
  private readonly logger = new Logger(ScanProcessor.name);
  private readonly fileClassifier = new FileClassifier();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ScanGateway,
    private readonly orchestrator: ScannerOrchestrator,
    private readonly aiReviewer: AIReviewerService,
    private readonly scoringService: ScoringService,
    private readonly reportService: ReportService,
    private readonly larkService: LarkService,
    private readonly notificationService: NotificationService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  public async process(job: Job<any, any, string>): Promise<any> {
    const { scanId, scanDir, timeoutMs } = job.data;
    this.logger.log(
      `Processing scan job pipeline: ${scanId} in directory: ${scanDir}`,
    );

    // If a timeout is specified (e.g., for PR-triggered scans), wrap execution
    // in a race against a timeout promise so that long-running scans are cancelled.
    if (timeoutMs && typeof timeoutMs === 'number' && timeoutMs > 0) {
      return Promise.race([
        this.executeProcessing(scanId, scanDir, job),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Scan timed out after ${Math.round(timeoutMs / 1000)}s`)),
            timeoutMs,
          ),
        ),
      ]).catch(async (err: any) => {
        this.logger.error(`Scan pipeline crashed: ${err.message}`, err.stack);
        await this.prisma.scanJob.update({
          where: { id: scanId },
          data: {
            status: "failed",
            statusResult: "blocked",
            failureReason: err.message,
            completedAt: new Date(),
          },
        });
        await this.updateProgress(
          scanId,
          "failed",
          100,
          `Scan failed: ${err.message}`,
        );
        // Emit scan.completed so downstream handlers (e.g., GitHubAppService)
        // can post error commit statuses for PR-triggered scans that failed/timed out.
        this.eventEmitter.emit("scan.completed", { scanId });
      }).finally(() => {
        this.removeScanDir(scanDir);
      });
    }

    return this.executeProcessing(scanId, scanDir, job).catch(async (err: any) => {
      this.logger.error(`Scan pipeline crashed: ${err.message}`, err.stack);
      await this.prisma.scanJob.update({
        where: { id: scanId },
        data: {
          status: "failed",
          statusResult: "blocked",
          failureReason: err.message,
          completedAt: new Date(),
        },
      });
      await this.updateProgress(
        scanId,
        "failed",
        100,
        `Scan failed: ${err.message}`,
      );
      // Emit scan.completed so downstream handlers (e.g., GitHubAppService)
      // can post error commit statuses for PR-triggered scans that failed/timed out.
      this.eventEmitter.emit("scan.completed", { scanId });
    }).finally(() => {
      this.removeScanDir(scanDir);
    });
  }

  private async executeProcessing(
    scanId: string,
    scanDir: string,
    job?: Job<any, any, string>,
  ): Promise<any> {
      // Stage timing markers feed the ScanMetrics telemetry persisted at the end.
      const tStart = Date.now();
      const queueWaitMs =
        job && typeof job.timestamp === "number"
          ? Math.max(0, (job.processedOn ?? tStart) - job.timestamp)
          : null;

      // Resolve the scan profile (scanMode) and any per-project custom rules up
      // front so they can gate analyzer selection, file scope, and the AI pass.
      const scanRow = await this.prisma.scanJob.findUnique({
        where: { id: scanId },
        select: { scanMode: true, project: { select: { customRules: true } } },
      });
      const scanMode = scanRow?.scanMode ?? "full";
      const enabledAnalyzers = analyzersForMode(scanMode) ?? undefined;
      const customRules = this.parseCustomRules(scanRow?.project?.customRules);

      // 1. Stage: FETCHING
      await this.updateProgress(
        scanId,
        "fetching",
        10,
        "Indexing source code files...",
      );
      if (!fs.existsSync(scanDir)) {
        throw new Error(`Scan directory not found: ${scanDir}`);
      }

      const files = await this.globFiles(scanDir);
      this.logger.log(`Found ${files.length} files to scan in ${scanId}`);
      const tFetch = Date.now();

      // 2. Stage: CLASSIFYING
      await this.updateProgress(
        scanId,
        "classifying",
        25,
        "Classifying file types and environments...",
      );
      const classified = this.fileClassifier.classifyFiles(files);

      // Store in DB
      await this.prisma.scanFile.createMany({
        data: classified.map((f) => ({
          scanJobId: scanId,
          filePath: f.path,
          language: f.language,
          fileType: f.fileType,
          isFrontend: f.isFrontend,
          isBackend: f.isBackend,
        })),
      });
      const tClassify = Date.now();

      // 3. Stage: SCANNING (Static analysis)
      await this.updateProgress(
        scanId,
        "scanning",
        40,
        "Executing static analysis security scanners...",
      );
      const staticFileList = capFiles(
        classified.filter((f) => f.fileType !== "dependency").map((f) => f.path),
        maxAnalyzeFiles(),
      );
      const { findings: staticFindings, coverage: analyzerCoverage } =
        await this.orchestrator.runAll({
          scanDir,
          files: staticFileList,
          scanId,
          enabledAnalyzers,
          customRules,
        });
      const tStatic = Date.now();

      // 4. Stage: AI-REVIEWING
      await this.updateProgress(
        scanId,
        "ai-reviewing",
        60,
        "Initiating LLM codebase review pass...",
      );
      let aiFindings: any[] = [];
      let aiSummary = "No issues identified.";
      let refactorPlan: string[] = [];
      let recommendedTests: string[] = [];
      let aiInputTokens: number | null = null;
      let aiOutputTokens: number | null = null;

      // We only run AI review on actual source code files (scoped by scanMode),
      // and limit total context size. `fast` mode skips the AI pass entirely.
      const codeFiles = capFiles(
        classified
          .filter((f) => f.fileType === "frontend" || f.fileType === "backend")
          .filter((f) => fileMatchesMode(scanMode, f)),
        maxAnalyzeFiles(),
      );

      if (codeFiles.length > 0 && shouldRunAiForMode(scanMode)) {
        // Read all candidate files in parallel (async) so we don't block the
        // event loop. Secret redaction happens once inside the AI provider, so
        // raw content is passed here (the provider is the single redaction site).
        const fileContents = (
          await Promise.all(
            codeFiles.map(async (f) => {
              try {
                const content = await fs.promises.readFile(
                  path.join(scanDir, f.path),
                  "utf8",
                );
                return {
                  path: f.path,
                  content,
                  language: f.language,
                  isFrontend: f.isFrontend,
                  isBackend: f.isBackend,
                };
              } catch (readErr: any) {
                this.logger.warn(
                  `Skipping unreadable file ${f.path}: ${readErr?.message ?? readErr}`,
                );
                return null;
              }
            }),
          )
        ).filter((f): f is NonNullable<typeof f> => f !== null);

        const existingSummary = staticFindings.map((f) => ({
          title: f.title,
          severity: f.severity,
          file: f.file,
        }));

        try {
          const aiResult = await this.aiReviewer.reviewCode(
            scanId,
            fileContents,
            existingSummary,
          );
          aiFindings = aiResult.findings;
          aiSummary = aiResult.summary;
          refactorPlan = aiResult.refactor_plan;
          recommendedTests = aiResult.recommended_tests;
          if (aiResult.usage) {
            aiInputTokens = aiResult.usage.inputTokens;
            aiOutputTokens = aiResult.usage.outputTokens;
          }
        } catch (aiErr: any) {
          this.logger.error(`AI Review pass failed: ${aiErr.message}`);
          aiSummary = `AI Review failed: ${aiErr.message}`;
        }
      }
      const tAi = Date.now();

      // Convert and save findings
      const allFindingsToSave: any[] = [];

      // Add static findings — persist the FULL standards array (previously only
      // standardReferences[0] survived, silently dropping every other mapping).
      for (const sf of staticFindings) {
        allFindingsToSave.push({
          scanJobId: scanId,
          filePath: sf.file,
          lineNumber: sf.line || null,
          severity: sf.severity,
          category: sf.category,
          title: sf.title,
          description: sf.whyItMatters,
          standardReferences: sf.standardReferences ?? [],
          recommendation: sf.recommendation,
          suggestedTests: sf.suggestedTests ?? [],
          blocking: sf.blocking,
          confidence: sf.confidence,
          source: sf.source,
          codeSnippet: sf.codeSnippet || null,
        });
      }

      // Add AI findings — preserve the per-finding suggested tests and code
      // snippet the model returns (both were previously hardcoded away).
      for (const af of aiFindings) {
        allFindingsToSave.push({
          scanJobId: scanId,
          filePath: af.file,
          lineNumber: af.line || null,
          severity: af.severity,
          category: af.category,
          title: af.title,
          description: af.why_it_matters,
          standardReferences: af.standard ? [af.standard] : [],
          recommendation: af.recommendation,
          suggestedTests: Array.isArray(af.suggested_tests)
            ? af.suggested_tests
            : [],
          blocking: af.blocking,
          confidence: af.confidence,
          source: "ai-reviewer",
          codeSnippet: af.code_snippet || null,
        });
      }

      if (allFindingsToSave.length > 0) {
        await this.prisma.finding.createMany({
          data: allFindingsToSave,
        });
      }

      // Fetch saved findings for scoring
      const savedFindings = await this.prisma.finding.findMany({
        where: { scanJobId: scanId },
      });

      // 5. Stage: SCORING
      await this.updateProgress(
        scanId,
        "scoring",
        80,
        "Computing SlopShield quality scores...",
      );
      const score = this.scoringService.calculateScore(savedFindings as any);

      // Save scoring and AI findings back to ScanJob
      await this.prisma.scanJob.update({
        where: { id: scanId },
        data: {
          overallScore: score.overallScore,
          securityScore: score.categoryScores.security,
          maintainabilityScore: score.categoryScores.maintainability,
          architectureScore: score.categoryScores.architecture,
          testabilityScore: score.categoryScores.testability,
          frontendScore: score.categoryScores.frontend,
          reliabilityScore: score.categoryScores.reliability,
          documentationScore: score.categoryScores.documentation,
          statusResult: score.statusResult,
          aiSummary,
          refactorPlan,
          recommendedTests,
          analyzerCoverage: analyzerCoverage as any,
          completedAt: new Date(),
        },
      });
      const tScoring = Date.now();

      // Persist per-scan observability telemetry (best-effort; never fails the scan).
      await this.persistMetrics(scanId, {
        queueWaitMs,
        fetchMs: tFetch - tStart,
        classifyMs: tClassify - tFetch,
        staticAnalysisMs: tStatic - tClassify,
        aiReviewMs: tAi - tStatic,
        scoringMs: tScoring - tAi,
        totalMs: tScoring - tStart,
        totalFiles: files.length,
        classifiedFiles: classified.length,
        analyzedFiles: staticFileList.length,
        staticFindingCount: staticFindings.length,
        aiFindingCount: aiFindings.length,
        blockingFindingCount: savedFindings.filter((f) => f.blocking).length,
        aiInputTokens,
        aiOutputTokens,
        analyzerBreakdown: analyzerCoverage as any,
      });

      // 6. Stage: REPORTING
      await this.updateProgress(
        scanId,
        "reporting",
        90,
        "Packaging final engineering report...",
      );

      // 7. Stage: NOTIFYING
      await this.updateProgress(
        scanId,
        "notifying",
        95,
        "Pushing card notification to Lark...",
      );
      try {
        await this.larkService.sendScanCard(scanId);
      } catch (larkErr: any) {
        this.logger.error(`Lark card push failed: ${larkErr.message}`);
      }

      try {
        await this.notificationService.processScanNotifications(scanId);
      } catch (alertErr: any) {
        this.logger.error(
          `Workspace alerts dispatch failed: ${alertErr.message}`,
        );
      }

      // 8. Stage: COMPLETED
      await this.updateProgress(
        scanId,
        "completed",
        100,
        "Scan completed successfully.",
      );
      this.eventEmitter.emit("scan.completed", { scanId });
      this.logger.log(`Scan job completed: ${scanId}`);
  }

  /**
   * Best-effort removal of a Scan_Directory and its temporary contents.
   * Cleanup failures are logged but never rethrown so they cannot mask the
   * scan's real terminal outcome (Req 4.10, 4.10a).
   */
  private removeScanDir(scanDir: string): void {
    if (!scanDir || !fs.existsSync(scanDir)) {
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

  private async updateProgress(
    scanId: string,
    stage: any,
    percentage: number,
    message: string,
  ): Promise<void> {
    await this.prisma.scanJob.update({
      where: { id: scanId },
      data: { status: stage },
    });
    this.gateway.broadcastProgress(scanId, { stage, percentage, message });
  }

  /**
   * Asynchronously walk a directory tree, returning file paths relative to
   * `baseDir`. Uses `withFileTypes` to avoid a `stat` per entry and async I/O so
   * indexing a large repo does not block the worker/API event loop.
   */
  private async globFiles(dir: string, baseDir = dir): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.globFiles(filePath, baseDir)));
      } else if (entry.isFile()) {
        results.push(path.relative(baseDir, filePath));
      }
    }
    return results;
  }

  /**
   * Validate a project's stored custom rules JSON against the shared schema,
   * returning an empty list on absence or malformed data (never throws).
   */
  private parseCustomRules(raw: unknown): CustomRule[] {
    if (!raw) {
      return [];
    }
    const parsed = CustomRuleListSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        `Ignoring malformed project customRules: ${parsed.error.message}`,
      );
      return [];
    }
    return parsed.data;
  }

  /**
   * Best-effort persistence of per-scan telemetry into ScanMetrics. Never throws
   * so a metrics failure cannot mask or fail the scan's real outcome.
   */
  private async persistMetrics(
    scanId: string,
    data: {
      queueWaitMs: number | null;
      fetchMs: number;
      classifyMs: number;
      staticAnalysisMs: number;
      aiReviewMs: number;
      scoringMs: number;
      totalMs: number;
      totalFiles: number;
      classifiedFiles: number;
      analyzedFiles: number;
      staticFindingCount: number;
      aiFindingCount: number;
      blockingFindingCount: number;
      aiInputTokens: number | null;
      aiOutputTokens: number | null;
      analyzerBreakdown: any;
    },
  ): Promise<void> {
    try {
      await this.prisma.scanMetrics.upsert({
        where: { scanJobId: scanId },
        create: { scanJobId: scanId, ...data },
        update: { ...data },
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to persist scan metrics for ${scanId}: ${err?.message ?? err}`,
      );
    }
  }
}
