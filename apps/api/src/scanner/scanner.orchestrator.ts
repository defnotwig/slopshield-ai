import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Finding } from "@slopshield/shared";
import {
  StaticAnalyzer,
  ESLintAnalyzer,
  TypeScriptAnalyzer,
  SecretAnalyzer,
  SemgrepAnalyzer,
  AnalysisContext,
  AnalysisResult,
} from "@slopshield/scanner-plugins";

@Injectable()
export class ScannerOrchestrator implements OnModuleInit {
  private readonly logger = new Logger(ScannerOrchestrator.name);
  private analyzers: StaticAnalyzer[] = [];

  public async onModuleInit(): Promise<void> {
    // Register all pluggable static analyzers
    this.analyzers = [
      new SecretAnalyzer(),
      new ESLintAnalyzer(),
      new TypeScriptAnalyzer(),
      new SemgrepAnalyzer(),
    ];

    // Log available analyzers
    for (const analyzer of this.analyzers) {
      const available = await analyzer.isAvailable();
      this.logger.log(
        `Scanner registered: [${analyzer.name}] - Available: ${available}`,
      );
    }
  }

  /**
   * Runs all available static analyzers in parallel against the analysis context.
   * Handles individual scanner failures gracefully so that one failing plugin does
   * not crash the entire scanning pipeline.
   *
   * @param context Ingestion context containing scan directory and target files
   * @returns Array of combined Omit<Finding, 'id' | 'scanId'>[]
   */
  public async runAll(
    context: AnalysisContext,
  ): Promise<Omit<Finding, "id" | "scanId">[]> {
    const activeAnalyzers: StaticAnalyzer[] = [];

    // Filter to only run available analyzers
    for (const analyzer of this.analyzers) {
      if (await analyzer.isAvailable()) {
        activeAnalyzers.push(analyzer);
      } else {
        this.logger.warn(
          `Scanner [${analyzer.name}] is unavailable; skipping.`,
        );
      }
    }

    if (activeAnalyzers.length === 0) {
      this.logger.warn("No static analyzers are available to run.");
      return [];
    }

    this.logger.log(
      `Running ${activeAnalyzers.length} static analyzers in parallel on ${context.files.length} files...`,
    );

    const promises = activeAnalyzers.map(async (analyzer) => {
      try {
        const result = await analyzer.analyze(context);
        return result;
      } catch (err: any) {
        return {
          analyzerName: analyzer.name,
          success: false,
          findings: [],
          error: err.message || String(err),
          durationMs: 0,
        };
      }
    });

    const results = await Promise.allSettled(promises);
    const combinedFindings: Omit<Finding, "id" | "scanId">[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const analyzerName = activeAnalyzers[i].name;

      if (result.status === "fulfilled") {
        const analysisResult = result.value;
        if (analysisResult.success) {
          this.logger.log(
            `Analyzer [${analyzerName}] completed: ${analysisResult.findings.length} findings in ${analysisResult.durationMs}ms`,
          );
          combinedFindings.push(...analysisResult.findings);
        } else {
          this.logger.error(
            `Analyzer [${analyzerName}] failed: ${analysisResult.error || "Unknown error"}`,
          );
        }
      } else {
        this.logger.error(
          `Analyzer [${analyzerName}] promise rejected: ${String(result.reason)}`,
        );
      }
    }

    return combinedFindings;
  }
}
