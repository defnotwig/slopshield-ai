import { Finding, FindingCategory, FindingSeverity } from "@slopshield/shared";
import {
  StaticAnalyzer,
  AnalysisContext,
  AnalysisResult,
} from "../interfaces/static-analyzer.interface.js";

export class ESLintAnalyzer implements StaticAnalyzer {
  public readonly name = "eslint";
  public readonly description =
    "Runs ESLint with security, architecture, and accessibility checks";

  public async isAvailable(): Promise<boolean> {
    try {
      // Check if eslint package is resolvable in the current node context
      require.resolve("eslint");
      return true;
    } catch {
      return false;
    }
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
          error: "ESLint package is not available in the environment.",
          durationMs: Date.now() - startTime,
        };
      }

      // Dynamically load ESLint to prevent require errors at startup if it's missing
      const { ESLint } = require("eslint");

      const eslintInstance = new ESLint({
        cwd: context.scanDir,
        useEslintrc: true, // Respect local workspace configuration
        overrideConfig: {
          env: {
            node: true,
            browser: true,
            es2021: true,
          },
          rules: {
            "no-eval": "error",
            "no-implied-eval": "error",
            "no-new-func": "error",
            "no-console": "warn",
            "no-debugger": "error",
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            eqeqeq: ["warn", "always"],
          },
        },
      });

      const results = await eslintInstance.lintFiles(
        context.files.map((file) => `${context.scanDir}/${file}`),
      );

      const findings: Omit<Finding, "id" | "scanId">[] = [];

      for (const result of results) {
        // ESLint returns absolute file path. Map it back to workspace-relative path.
        const relativeFilePath = result.filePath
          .replace(context.scanDir.replace(/\\/g, "/"), "")
          .replace(/^\//, "");

        for (const message of result.messages) {
          // Determine severity: 1 is warning, 2 is error
          const severity: FindingSeverity =
            message.severity === 2 ? "high" : "medium";

          // Classify based on rule ID
          const category = this.mapRuleIdToCategory(
            message.ruleId || "",
            relativeFilePath,
          );

          // Map to standards
          const standardReferences = this.mapRuleIdToStandards(
            message.ruleId || "",
          );

          findings.push({
            severity,
            category,
            title: message.message,
            file: relativeFilePath,
            line: message.line,
            standardReferences,
            whyItMatters: `Static linting rule violation: '${message.ruleId || "unknown-rule"}'. Maintaining consistent lint standards prevents common programming errors, maintains visual consistency, and controls codebase technical debt.`,
            recommendation: `Refactor the code to resolve the ESLint warning/error: ${message.message}. Or disable the rule locally with an eslint-disable comment if this is an approved exception.`,
            blocking: message.severity === 2, // Map errors as blocking
            confidence: 0.9,
            source: "eslint",
            codeSnippet: message.source ? message.source.trim() : undefined,
          });
        }
      }

      return {
        analyzerName: this.name,
        success: true,
        findings,
        durationMs: Date.now() - startTime,
      };
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

  private mapRuleIdToCategory(
    ruleId: string,
    filePath: string,
  ): FindingCategory {
    const isFrontend =
      filePath.includes("components/") ||
      filePath.includes("pages/") ||
      filePath.includes("app/") ||
      filePath.includes("views/") ||
      filePath.endsWith(".tsx") ||
      filePath.endsWith(".jsx");

    if (
      ruleId.includes("security") ||
      ruleId.includes("xss") ||
      ruleId.includes("csrf") ||
      ruleId.includes("eval")
    ) {
      return isFrontend ? "frontend-security" : "backend-security";
    }

    if (ruleId.includes("a11y") || ruleId.includes("jsx-a11y")) {
      return "accessibility";
    }

    if (
      ruleId.includes("react") ||
      ruleId.includes("next") ||
      ruleId.includes("html")
    ) {
      return "accessibility"; // UX / Frontend
    }

    if (
      ruleId.includes("import") ||
      ruleId.includes("module") ||
      ruleId.includes("require")
    ) {
      return isFrontend ? "frontend-architecture" : "backend-architecture";
    }

    return "maintainability"; // Default fallback
  }

  private mapRuleIdToStandards(ruleId: string): string[] {
    const standards: string[] = [];

    if (
      ruleId.includes("security") ||
      ruleId.includes("xss") ||
      ruleId.includes("eval")
    ) {
      standards.push("OWASP_TOP_10", "CWE_TOP_25");
    } else if (ruleId.includes("a11y") || ruleId.includes("jsx-a11y")) {
      standards.push("WCAG_22");
    } else {
      standards.push("CLEAN_CODE");
    }

    return standards;
  }
}
