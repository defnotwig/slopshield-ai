import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { ScanGateway } from './scan.gateway.js';
import { FileClassifier } from '@slopshield/scanner-plugins';
import { ScannerOrchestrator } from '../scanner/scanner.orchestrator.js';
import { AIReviewerService } from '../ai-reviewer/ai-reviewer.service.js';
import { ScoringService } from '../scoring/scoring.service.js';
import { ReportService } from '../report/report.service.js';
import { LarkService } from '../lark/lark.service.js';

@Processor('scan-pipeline')
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
    private readonly larkService: LarkService
  ) {
    super();
  }

  public async process(job: Job<any, any, string>): Promise<any> {
    const { scanId, scanDir } = job.data;
    this.logger.log(`Processing scan job pipeline: ${scanId} in directory: ${scanDir}`);

    try {
      // 1. Stage: FETCHING
      await this.updateProgress(scanId, 'fetching', 10, 'Indexing source code files...');
      if (!fs.existsSync(scanDir)) {
        throw new Error(`Scan directory not found: ${scanDir}`);
      }

      const files = this.globFilesSync(scanDir);
      this.logger.log(`Found ${files.length} files to scan in ${scanId}`);

      // 2. Stage: CLASSIFYING
      await this.updateProgress(scanId, 'classifying', 25, 'Classifying file types and environments...');
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

      // 3. Stage: SCANNING (Static analysis)
      await this.updateProgress(scanId, 'scanning', 40, 'Executing static analysis security scanners...');
      const staticFindings = await this.orchestrator.runAll({
        scanDir,
        files: classified.filter((f) => f.fileType !== 'dependency').map((f) => f.path),
        scanId,
      });

      // 4. Stage: AI-REVIEWING
      await this.updateProgress(scanId, 'ai-reviewing', 60, 'Initiating LLM codebase review pass...');
      let aiFindings: any[] = [];
      let aiSummary = 'No issues identified.';
      let refactorPlan: string[] = [];
      let recommendedTests: string[] = [];

      // We only run AI review on actual source code files, and limit total context size
      const codeFiles = classified
        .filter((f) => f.fileType === 'frontend' || f.fileType === 'backend')
        .slice(0, 10); // Cap at 10 files for hackathon context limit

      if (codeFiles.length > 0) {
        const fileContents = codeFiles.map((f) => ({
          path: f.path,
          content: fs.readFileSync(path.join(scanDir, f.path), 'utf8'),
          language: f.language,
          isFrontend: f.isFrontend,
          isBackend: f.isBackend,
        }));

        const existingSummary = staticFindings.map((f) => ({
          title: f.title,
          severity: f.severity,
          file: f.file,
        }));

        try {
          const aiResult = await this.aiReviewer.reviewCode(scanId, fileContents, existingSummary);
          aiFindings = aiResult.findings;
          aiSummary = aiResult.summary;
          refactorPlan = aiResult.refactor_plan;
          recommendedTests = aiResult.recommended_tests;
        } catch (aiErr: any) {
          this.logger.error(`AI Review pass failed: ${aiErr.message}`);
          aiSummary = `AI Review failed: ${aiErr.message}`;
        }
      }

      // Convert and save findings
      const allFindingsToSave: any[] = [];

      // Add static findings
      for (const sf of staticFindings) {
        allFindingsToSave.push({
          scanJobId: scanId,
          filePath: sf.file,
          lineNumber: sf.line || null,
          severity: sf.severity,
          category: sf.category,
          title: sf.title,
          description: sf.whyItMatters,
          standardReference: sf.standardReferences[0] || null,
          recommendation: sf.recommendation,
          suggestedTests: sf.suggestedTests ? sf.suggestedTests : [],
          blocking: sf.blocking,
          confidence: sf.confidence,
          source: sf.source,
          codeSnippet: sf.codeSnippet || null,
        });
      }

      // Add AI findings
      for (const af of aiFindings) {
        allFindingsToSave.push({
          scanJobId: scanId,
          filePath: af.file,
          lineNumber: af.line || null,
          severity: af.severity,
          category: af.category,
          title: af.title,
          description: af.why_it_matters,
          standardReference: af.standard || null,
          recommendation: af.recommendation,
          suggestedTests: [],
          blocking: af.blocking,
          confidence: af.confidence,
          source: 'ai-reviewer',
          codeSnippet: null,
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
      await this.updateProgress(scanId, 'scoring', 80, 'Computing SlopShield quality scores...');
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
          backendScore: score.categoryScores.reliability, // reliability mapped to backendScore
          statusResult: score.statusResult,
          aiSummary,
          refactorPlan,
          recommendedTests,
          completedAt: new Date(),
        },
      });

      // 6. Stage: REPORTING
      await this.updateProgress(scanId, 'reporting', 90, 'Packaging final engineering report...');

      // 7. Stage: NOTIFYING
      await this.updateProgress(scanId, 'notifying', 95, 'Pushing card notification to Lark...');
      try {
        await this.larkService.sendScanCard(scanId);
      } catch (larkErr: any) {
        this.logger.error(`Lark card push failed: ${larkErr.message}`);
      }

      // 8. Stage: COMPLETED
      await this.updateProgress(scanId, 'completed', 100, 'Scan completed successfully.');
      this.logger.log(`Scan job completed: ${scanId}`);

      // Clean up directory
      if (fs.existsSync(scanDir)) {
        fs.rmSync(scanDir, { recursive: true, force: true });
      }
    } catch (err: any) {
      this.logger.error(`Scan pipeline crashed: ${err.message}`, err.stack);
      await this.prisma.scanJob.update({
        where: { id: scanId },
        data: {
          status: 'failed',
          statusResult: 'blocked',
          completedAt: new Date(),
        },
      });
      await this.updateProgress(scanId, 'failed', 100, `Scan failed: ${err.message}`);
      if (fs.existsSync(scanDir)) {
        fs.rmSync(scanDir, { recursive: true, force: true });
      }
    }
  }

  private async updateProgress(scanId: string, stage: any, percentage: number, message: string): Promise<void> {
    await this.prisma.scanJob.update({
      where: { id: scanId },
      data: { status: stage },
    });
    this.gateway.broadcastProgress(scanId, { stage, percentage, message });
  }

  private globFilesSync(dir: string, baseDir = dir): string[] {
    const results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        results.push(...this.globFilesSync(filePath, baseDir));
      } else {
        const relative = path.relative(baseDir, filePath);
        results.push(relative);
      }
    }
    return results;
  }
}
