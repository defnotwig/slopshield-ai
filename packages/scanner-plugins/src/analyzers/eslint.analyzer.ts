import { Finding, FindingCategory, FindingSeverity } from "@slopshield/shared";
import {
  StaticAnalyzer,
  AnalysisContext,
  AnalysisResult,
} from "../interfaces/static-analyzer.interface.js";

/**
 * Baseline lint rules applied to every scanned repository. These are bundled
 * with the analyzer and are used regardless of the scanned repository's own
 * ESLint configuration (Req 5.3) so that coverage is consistent and cannot be
 * weakened by a repo that disables our security/quality rules.
 */
const BASELINE_RULES: Record<string, unknown> = {
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-console": "warn",
  "no-debugger": "error",
  "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
  eqeqeq: ["warn", "always"],
};

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

  /**
   * Builds an ESLint instance that ALWAYS uses the bundled baseline config and
   * never the scanned repository's configuration (Req 5.3). Supports both the
   * flat-config API (ESLint v9: `overrideConfigFile: true`) and the legacy
   * eslintrc API (ESLint v8: `useEslintrc: false`); in both cases the repo's
   * own config files are ignored.
   */
  private createBundledEslint(ESLint: any, scanDir: string): any {
    const version: string = String(ESLint.version ?? "");
    const major = Number.parseInt(version.split(".")[0], 10);

    if (Number.isFinite(major) && major >= 9) {
      // Flat config (ESLint v9+). `overrideConfigFile: true` disables lookup of
      // any repo eslint.config.* file, guaranteeing the bundled config is used.
      return new ESLint({
        cwd: scanDir,
        overrideConfigFile: true,
        overrideConfig: [
          {
            languageOptions: {
              ecmaVersion: "latest",
              sourceType: "module",
            },
            rules: BASELINE_RULES,
          },
        ],
      });
    }

    // Legacy eslintrc (ESLint v8 and below). `useEslintrc: false` disables
    // discovery of repo .eslintrc* files, guaranteeing the bundled config.
    return new ESLint({
      cwd: scanDir,
      useEslintrc: false,
      overrideConfig: {
        env: {
          node: true,
          browser: true,
          es2021: true,
        },
        parserOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
        },
        rules: BASELINE_RULES,
      },
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
          error: "ESLint package is not available in the environment.",
          durationMs: Date.now() - startTime,
        };
      }

      // Dynamically load ESLint to prevent require errors at startup if it's missing
      const { ESLint } = require("eslint");

      const eslintInstance = this.createBundledEslint(ESLint, context.scanDir);

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
