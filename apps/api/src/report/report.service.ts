import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  public async generateReport(scanId: string): Promise<any> {
    const scan = await this.prisma.scanJob.findUnique({
      where: { id: scanId },
      include: {
        project: true,
        scanFiles: true,
        findings: {
          orderBy: [{ falsePositive: "asc" }, { severity: "asc" }],
        },
      },
    });

    if (!scan) {
      throw new NotFoundException(`Scan job with ID ${scanId} not found`);
    }

    return {
      id: scan.id,
      projectId: scan.projectId,
      projectName: scan.project?.name || null,
      triggerType: scan.triggerType,
      sourceType: scan.sourceType,
      sourceRef: scan.sourceRef,
      status: scan.status,
      scanMode: scan.scanMode,
      overallScore: scan.overallScore,
      statusResult: scan.statusResult,
      aiSummary: scan.aiSummary,
      refactorPlan: scan.refactorPlan,
      recommendedTests: scan.recommendedTests,
      startedAt: scan.startedAt,
      completedAt: scan.completedAt,
      createdAt: scan.createdAt,
      categoryScores: {
        security: scan.securityScore ?? 0,
        maintainability: scan.maintainabilityScore ?? 0,
        architecture: scan.architectureScore ?? 0,
        testability: scan.testabilityScore ?? 0,
        frontend: scan.frontendScore ?? 0,
        reliability: scan.backendScore ?? 0,
        documentation: 100, // Default base
      },
      files: scan.scanFiles.map((f) => ({
        path: f.filePath,
        language: f.language,
        fileType: f.fileType,
        isFrontend: f.isFrontend,
        isBackend: f.isBackend,
      })),
      findings: scan.findings.map((f) => ({
        id: f.id,
        severity: f.severity,
        category: f.category,
        title: f.title,
        description: f.description,
        file: f.filePath,
        line: f.lineNumber,
        standardReferences: f.standardReference ? [f.standardReference] : [],
        recommendation: f.recommendation,
        suggestedTests: (f.suggestedTests as string[]) || [],
        blocking: f.blocking,
        confidence: f.confidence || 0.5,
        source: f.source,
        codeSnippet: f.codeSnippet,
        falsePositive: f.falsePositive,
      })),
    };
  }

  public async getReportSummary(scanId: string): Promise<any> {
    const report = await this.generateReport(scanId);
    const topFindings = report.findings
      .filter((f: any) => !f.falsePositive)
      .slice(0, 5)
      .map((f: any) => ({
        title: f.title,
        severity: f.severity,
      }));

    return {
      scanId: report.id,
      repository: report.sourceRef || report.projectName || "Pasted Code",
      author: "Developer",
      score: report.overallScore || 0,
      status: report.statusResult || "blocked",
      topFindings,
      reportUrl: `http://localhost:3000/scans/${report.id}/report`,
    };
  }
}
