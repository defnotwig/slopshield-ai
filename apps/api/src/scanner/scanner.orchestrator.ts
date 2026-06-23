import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Finding, AnalyzerCoverage, FindingSource } from "@slopshield/shared";
import {
  StaticAnalyzer,
  ESLintAnalyzer,
  TypeScriptAnalyzer,
  SecretAnalyzer,
  SemgrepAnalyzer,
  SlopAnalyzer,
  AnalysisContext,
  AnalysisResult,
} from "@slopshield/scanner-plugins";

/** Result of running all analyzers: combined findings plus per-analyzer coverage. */
export interface OrchestratorResult {
  findings: Omit<Finding, "id" | "scanId">[];
  coverage: AnalyzerCoverage[];
}

@Injectable()
export class ScannerOrchestrator implements OnModuleInit {
  private readonly logger = new Logger(ScannerOrchestrator.name);
  private analyzers: StaticAnalyzer[] = [];
  private readonly analyzerTimeoutMs = Number(
    process.env.ANALYZER_TIMEOUT_MS ?? 45_000,
  );

  /**
   * Maps an analyzer's internal `name` to the shared `FindingSource` value used
   * in `AnalyzerCoverage`, so coverage attribution matches finding attribution.
   */
  private static readonly ANALYZER_SOURCE_MAP: Record<string, FindingSource> = {
    "secret-scanner": "secret-scanner",
    eslint: "eslint",
    "typescript-compiler": "typescript",
    semgrep: "semgrep",
    "slop-scanner": "rules-engine",
  };

  private resolveSource(analyzerName: string): FindingSource {
    return (
      ScannerOrchestrator.ANALYZER_SOURCE_MAP[analyzerName] ?? "rules-engine"
    );
  }

  public async onModuleInit(): Promise<void> {
    // Register all pluggable static analyzers
    this.analyzers = [
      new SecretAnalyzer(),
      new ESLintAnalyzer(),
      new TypeScriptAnalyzer(),
      new SemgrepAnalyzer(),
      new SlopAnalyzer(),
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
   * @returns Combined findings plus per-analyzer coverage records
   */
  public async runAll(context: AnalysisContext): Promise<OrchestratorResult> {
    const activeAnalyzers: StaticAnalyzer[] = [];
    const coverage: AnalyzerCoverage[] = [];

    // Filter to only run available analyzers; record unavailable ones as skipped.
    for (const analyzer of this.analyzers) {
      if (await analyzer.isAvailable()) {
        activeAnalyzers.push(analyzer);
      } else {
        this.logger.warn(
          `Scanner [${analyzer.name}] is unavailable; skipping.`,
        );
        coverage.push({
          analyzer: this.resolveSource(analyzer.name),
          status: "skipped",
          findingCount: 0,
          durationMs: 0,
          reason: "Analyzer is unavailable (CLI or dependency missing)",
        });
      }
    }

    if (activeAnalyzers.length === 0) {
      this.logger.warn("No static analyzers are available to run.");
      return { findings: [], coverage };
    }

    this.logger.log(
      `Running ${activeAnalyzers.length} static analyzers in parallel on ${context.files.length} files...`,
    );

    const promises = activeAnalyzers.map(async (analyzer) => {
      try {
        const result = await this.runWithTimeout(analyzer, context);
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
      const analyzer = activeAnalyzers[i];
      const analyzerName = analyzer.name;
      const source = this.resolveSource(analyzerName);

      if (result.status === "fulfilled") {
        const analysisResult = result.value;
        if (analysisResult.success) {
          this.logger.log(
            `Analyzer [${analyzerName}] completed: ${analysisResult.findings.length} findings in ${analysisResult.durationMs}ms`,
          );
          combinedFindings.push(...analysisResult.findings);
          coverage.push({
            analyzer: source,
            status: "ran",
            findingCount: analysisResult.findings.length,
            durationMs: Math.max(0, Math.round(analysisResult.durationMs)),
          });
        } else if (analysisResult.skipped) {
          // An optional analyzer (e.g. Semgrep) deliberately skipped because a
          // CLI or rule registry was unavailable. This must not fail the scan
          // (Req 5.7) — record it as `skipped`, not `failed`.
          this.logger.warn(
            `Analyzer [${analyzerName}] skipped: ${analysisResult.error || "unavailable"}`,
          );
          coverage.push({
            analyzer: source,
            status: "skipped",
            findingCount: 0,
            durationMs: Math.max(0, Math.round(analysisResult.durationMs)),
            reason: analysisResult.error || "Analyzer skipped",
          });
        } else {
          this.logger.error(
            `Analyzer [${analyzerName}] failed: ${analysisResult.error || "Unknown error"}`,
          );
          coverage.push({
            analyzer: source,
            status: "failed",
            findingCount: 0,
            durationMs: Math.max(0, Math.round(analysisResult.durationMs)),
            reason: analysisResult.error || "Unknown error",
          });
        }
      } else {
        this.logger.error(
          `Analyzer [${analyzerName}] promise rejected: ${String(result.reason)}`,
        );
        coverage.push({
          analyzer: source,
          status: "failed",
          findingCount: 0,
          durationMs: 0,
          reason: String(result.reason),
        });
      }
    }

    return { findings: combinedFindings, coverage };
  }

  /**
   * Races an analyzer's `analyze()` against the configured timeout. On timeout
   * this resolves (never rejects) to a failed `AnalysisResult` so that a hung
   * analyzer cannot stall or crash the overall scan. The timer is always
   * cleared in a `finally` block.
   *
   * @param analyzer The static analyzer to run
   * @param context Ingestion context containing scan directory and target files
   * @returns The analyzer's result, or a failed result on timeout
   */
  private async runWithTimeout(
    analyzer: StaticAnalyzer,
    context: AnalysisContext,
  ): Promise<AnalysisResult> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<AnalysisResult>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            analyzerName: analyzer.name,
            success: false,
            findings: [],
            error: `Analyzer timed out after ${this.analyzerTimeoutMs}ms`,
            durationMs: this.analyzerTimeoutMs,
          }),
        this.analyzerTimeoutMs,
      );
    });
    try {
      return await Promise.race([analyzer.analyze(context), timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
