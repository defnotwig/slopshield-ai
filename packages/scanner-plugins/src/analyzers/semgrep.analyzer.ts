import * as child_process from "child_process";
import { Finding, FindingSeverity, FindingCategory } from "@slopshield/shared";
import {
  StaticAnalyzer,
  AnalysisContext,
  AnalysisResult,
} from "../interfaces/static-analyzer.interface.js";

export class SemgrepAnalyzer implements StaticAnalyzer {
  public readonly name = "semgrep";
  public readonly description =
    "Runs Semgrep static rules to catch security issues and code quality smells";

  public async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      // Execute semgrep --version. Resolve true if exit code is 0
      child_process.exec("semgrep --version", (error) => {
        resolve(!error);
      });
    });
  }

  public async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    const startTime = Date.now();

    try {
      const isAvailable = await this.isAvailable();
      if (!isAvailable) {
        return {
          analyzerName: this.name,
          success: false,
          findings: [],
          error:
            "Semgrep CLI is not installed or not available in system PATH.",
          durationMs: Date.now() - startTime,
        };
      }

      // Run semgrep on the scan directory targeting the subset of files to scan
      // For simplicity in a multi-file workspace, we pass the directory and filter targets if possible,
      // or we run it globally on the scan directory.
      // Running semgrep scan --json --config auto is standard.
      const cmd = `semgrep scan --json --config auto "${context.scanDir}"`;

      return new Promise<AnalysisResult>((resolve) => {
        child_process.exec(
          cmd,
          { maxBuffer: 10 * 1024 * 1024 },
          (error, stdout) => {
            // Note: semgrep exits with code 1 if findings are found, so we check stdout length
            // instead of failing outright on process error exit code.
            try {
              if (!stdout && error) {
                return resolve({
                  analyzerName: this.name,
                  success: false,
                  findings: [],
                  error: error.message,
                  durationMs: Date.now() - startTime,
                });
              }

              const rawJson = JSON.parse(stdout);
              const findings: Omit<Finding, "id" | "scanId">[] = [];

              // Semgrep JSON results are in rawJson.results
              const results = rawJson.results || [];

              for (const result of results) {
                // Path returned is relative to the directory scanned
                const relativeFilePath = result.path.replace(/\\/g, "/");

                // Filter findings to only include files that were requested for scan
                if (
                  context.files.length > 0 &&
                  !context.files.includes(relativeFilePath)
                ) {
                  continue;
                }

                const severity: FindingSeverity = this.mapSemgrepSeverity(
                  result.extra?.severity || "",
                );
                const category: FindingCategory = this.mapSemgrepCategory(
                  result.extra?.metadata?.category || "",
                  relativeFilePath,
                );
                const message = result.extra?.message || "Semgrep rule match";

                findings.push({
                  severity,
                  category,
                  title: message.split("\n")[0] || "Semgrep finding",
                  file: relativeFilePath,
                  line: result.start?.line,
                  standardReferences: this.mapMetadataToStandards(
                    result.extra?.metadata || {},
                  ),
                  whyItMatters: message,
                  recommendation:
                    result.extra?.metadata?.remediation ||
                    `Follow the Semgrep rule recommendation to refactor this code block and resolve the issue.`,
                  blocking: severity === "critical" || severity === "high",
                  confidence: 0.85,
                  source: "semgrep",
                  codeSnippet: result.extra?.lines?.trim(),
                });
              }

              resolve({
                analyzerName: this.name,
                success: true,
                findings,
                durationMs: Date.now() - startTime,
              });
            } catch (parseErr: any) {
              resolve({
                analyzerName: this.name,
                success: false,
                findings: [],
                error: `Failed to parse Semgrep output: ${parseErr.message}`,
                durationMs: Date.now() - startTime,
              });
            }
          },
        );
      });
    } catch (err: any) {
      return {
        analyzerName: this.name,
        success: false,
        findings: [],
        error: err.message || String(err),
        durationMs: Date.now() - startTime,
      };
    }
  }

  private mapSemgrepSeverity(semgrepSev: string): FindingSeverity {
    const lower = semgrepSev.toLowerCase();
    if (lower === "error") return "high";
    if (lower === "warning") return "medium";
    if (lower === "info") return "low";
    return "medium";
  }

  private mapSemgrepCategory(
    semgrepCategory: string,
    filePath: string,
  ): FindingCategory {
    const lower = semgrepCategory.toLowerCase();
    const isFrontend =
      filePath.includes("components/") ||
      filePath.includes("pages/") ||
      filePath.includes("app/") ||
      filePath.endsWith(".tsx") ||
      filePath.endsWith(".jsx");

    if (lower === "security") {
      return isFrontend ? "frontend-security" : "backend-security";
    }

    if (lower === "correctness") {
      return "reliability";
    }

    if (lower === "maintainability") {
      return "maintainability";
    }

    return isFrontend ? "accessibility" : "maintainability";
  }

  private mapMetadataToStandards(metadata: any): string[] {
    const standards: string[] = [];
    const owasp = metadata.owasp || [];
    const cwe = metadata.cwe || [];

    if (owasp.length > 0) {
      standards.push("OWASP_TOP_10");
    }
    if (cwe.length > 0) {
      standards.push("CWE_TOP_25");
    }

    if (standards.length === 0) {
      standards.push("CLEAN_CODE");
    }

    return standards;
  }
}
