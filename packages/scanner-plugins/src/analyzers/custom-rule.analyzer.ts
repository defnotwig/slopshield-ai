import * as fs from "fs";
import * as path from "path";
import { Finding, CustomRule } from "@slopshield/shared";
import {
  StaticAnalyzer,
  AnalysisContext,
  AnalysisResult,
} from "../interfaces/static-analyzer.interface.js";

type CustomFinding = Omit<Finding, "id" | "scanId">;

const SCANNABLE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".py",
  ".go",
  ".java",
  ".rb",
  ".php",
  ".cs",
  ".yaml",
  ".yml",
  ".env",
]);

/**
 * Applies a project's user-defined regex rules as an extra analysis pass.
 * Invalid regexes are skipped (never crash the scan); each rule may optionally
 * scope itself to files whose path contains one of its `fileGlobs` substrings.
 */
export class CustomRuleAnalyzer implements StaticAnalyzer {
  public readonly name = "custom-rules";
  public readonly description =
    "Applies per-project user-defined regex rules after the built-in analyzers";

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    const startTime = Date.now();
    const findings: CustomFinding[] = [];
    const rules = (context.customRules ?? []).filter((r) => r.enabled !== false);

    if (rules.length === 0) {
      return {
        analyzerName: this.name,
        success: true,
        skipped: true,
        findings: [],
        error: "No custom rules configured for this project.",
        durationMs: Date.now() - startTime,
      };
    }

    // Pre-compile rule regexes once; drop any that don't compile.
    const compiled = rules
      .map((rule) => {
        try {
          // Force a non-global regex per-line test (avoid lastIndex state).
          const flags = (rule.flags ?? "").replace(/g/g, "");
          return { rule, regex: new RegExp(rule.pattern, flags) };
        } catch {
          return null;
        }
      })
      .filter((c): c is { rule: CustomRule; regex: RegExp } => c !== null);

    try {
      for (const file of context.files) {
        if (!SCANNABLE_EXTS.has(path.extname(file).toLowerCase())) {
          continue;
        }
        const applicable = compiled.filter(({ rule }) =>
          this.fileMatchesRule(file, rule),
        );
        if (applicable.length === 0) {
          continue;
        }

        const abs = path.join(context.scanDir, file);
        let content: string;
        try {
          content = await fs.promises.readFile(abs, "utf8");
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);

        for (let i = 0; i < lines.length; i++) {
          for (const { rule, regex } of applicable) {
            if (regex.test(lines[i])) {
              findings.push(this.toFinding(rule, file, i + 1, lines[i].trim()));
            }
          }
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

  private fileMatchesRule(file: string, rule: CustomRule): boolean {
    if (!rule.fileGlobs || rule.fileGlobs.length === 0) {
      return true;
    }
    const norm = file.replaceAll("\\", "/");
    return rule.fileGlobs.some((g) => norm.includes(g));
  }

  private toFinding(
    rule: CustomRule,
    file: string,
    line: number,
    snippet: string,
  ): CustomFinding {
    return {
      severity: rule.severity,
      category: rule.category,
      title: `Custom Rule: ${rule.name}`,
      file,
      line,
      standardReferences: [],
      whyItMatters: rule.message,
      recommendation:
        rule.recommendation ?? "Resolve the issue flagged by this custom rule.",
      blocking: rule.blocking ?? false,
      confidence: 0.8,
      source: "custom-rules",
      codeSnippet: snippet.slice(0, 240),
    };
  }
}
