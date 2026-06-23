import * as fs from "fs";
import * as path from "path";
import { Finding } from "@slopshield/shared";
import {
  StaticAnalyzer,
  AnalysisContext,
  AnalysisResult,
} from "../interfaces/static-analyzer.interface.js";

/**
 * Confidence assigned to diagnostics depending on the configuration source.
 * Diagnostics produced from the repository's own `tsconfig.json` are trusted
 * fully; diagnostics produced from the lenient inferred/fallback baseline are
 * assigned a strictly lower confidence (Req 5.6).
 */
const CONFIDENCE_REPO_CONFIG = 1.0;
const CONFIDENCE_INFERRED_CONFIG = 0.6;

export class TypeScriptAnalyzer implements StaticAnalyzer {
  public readonly name = "typescript-compiler";
  public readonly description =
    "Runs TypeScript compiler checks to detect type errors and compilation issues";

  public async isAvailable(): Promise<boolean> {
    try {
      require.resolve("typescript");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the compiler options to use for a scan.
   *
   * - WHERE the repository contains a `tsconfig.json` (Req 5.4), parse and
   *   respect it (its `compilerOptions`), so diagnostics reflect the repo's own
   *   intended configuration.
   * - WHERE no repository `tsconfig.json` is present (Req 5.5), fall back to a
   *   lenient baseline configuration.
   *
   * Returns the compiler options and whether they were inferred (fallback) so
   * the caller can lower confidence for inferred diagnostics (Req 5.6).
   */
  private resolveCompilerOptions(
    ts: any,
    scanDir: string,
  ): { options: any; inferred: boolean } {
    const lenientBaseline: any = {
      noEmit: true,
      // Lenient: do NOT enable strict mode for inferred config so we avoid
      // over-reporting on repos that never opted into strictness.
      strict: false,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      esModuleInterop: true,
      skipLibCheck: true,
      allowJs: true,
    };

    const tsconfigPath = path.join(scanDir, "tsconfig.json");
    if (!fs.existsSync(tsconfigPath)) {
      return { options: lenientBaseline, inferred: true };
    }

    try {
      const readResult = ts.readConfigFile(tsconfigPath, (p: string) =>
        fs.readFileSync(p, "utf8"),
      );
      if (readResult.error) {
        return { options: lenientBaseline, inferred: true };
      }
      const parsed = ts.parseJsonConfigFileContent(
        readResult.config ?? {},
        ts.sys,
        scanDir,
      );
      const options = {
        ...parsed.options,
        // Always suppress emit during analysis regardless of repo settings.
        noEmit: true,
        skipLibCheck: true,
      };
      return { options, inferred: false };
    } catch {
      // Malformed tsconfig — degrade to the lenient baseline rather than fail.
      return { options: lenientBaseline, inferred: true };
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
          error: "TypeScript package is not available in the environment.",
          durationMs: Date.now() - startTime,
        };
      }

      const ts = require("typescript");

      // Resolve compiler options from the repo's tsconfig.json when present,
      // otherwise fall back to a lenient baseline.
      const { options: compilerOptions, inferred } = this.resolveCompilerOptions(
        ts,
        context.scanDir,
      );
      const diagnosticConfidence = inferred
        ? CONFIDENCE_INFERRED_CONFIG
        : CONFIDENCE_REPO_CONFIG;

      // Filter TS / TSX files for checking
      const tsFiles = context.files
        .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
        .map((file) => path.join(context.scanDir, file));

      if (tsFiles.length === 0) {
        return {
          analyzerName: this.name,
          success: true,
          findings: [],
          durationMs: Date.now() - startTime,
        };
      }

      // Create a program
      const program = ts.createProgram(tsFiles, compilerOptions);
      const diagnostics = ts.getPreEmitDiagnostics(program);

      const findings: Omit<Finding, "id" | "scanId">[] = [];

      for (const diagnostic of diagnostics) {
        // Only report diagnostics with file path
        if (diagnostic.file) {
          const filePath = diagnostic.file.fileName;
          // Normalise to relative
          const relativeFilePath = path
            .relative(context.scanDir, filePath)
            .replace(/\\/g, "/");

          // Skip library files (node_modules, typescript library definitions)
          if (
            relativeFilePath.includes("node_modules/") ||
            relativeFilePath.startsWith("..")
          ) {
            continue;
          }

          // Map TS diagnostic category to severity
          let severity: Finding["severity"] = "medium";
          if (diagnostic.category === ts.DiagnosticCategory.Error) {
            severity = "high";
          } else if (
            diagnostic.category === ts.DiagnosticCategory.Message ||
            diagnostic.category === ts.DiagnosticCategory.Suggestion
          ) {
            severity = "info";
          }

          // Diagnostics from inferred/fallback config get reduced severity:
          // a "high" error becomes "medium" because we are less certain the
          // repo actually intended these compiler settings (Req 5.6).
          if (inferred && severity === "high") {
            severity = "medium";
          }

          // Determine category: Code 2307 is "Cannot find module..." (hallucinated import smell)
          const isImportError =
            diagnostic.code === 2307 || diagnostic.code === 2792;
          const isFrontend =
            relativeFilePath.endsWith(".tsx") ||
            relativeFilePath.includes("components/");

          let category: Finding["category"] = "maintainability";
          if (isImportError) {
            category = isFrontend
              ? "frontend-architecture"
              : "backend-architecture";
          }

          const messageText = ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            "\n",
          );
          const lineAndCharacter =
            diagnostic.file.getLineAndCharacterOfPosition(
              diagnostic.start || 0,
            );

          let codeSnippet: string | undefined;
          try {
            const fileContent = fs.readFileSync(filePath, "utf8");
            const lines = fileContent.split(/\r?\n/);
            codeSnippet = lines[lineAndCharacter.line]?.trim();
          } catch {
            // Ignore if snippet can't be read
          }

          findings.push({
            severity,
            category,
            title: `TypeScript: ${messageText} (TS${diagnostic.code})`,
            file: relativeFilePath,
            line: lineAndCharacter.line + 1,
            standardReferences: isImportError
              ? ["CLEAN_CODE", "PHILOSOPHY_SOFTWARE_DESIGN"]
              : ["CLEAN_CODE", "CODE_COMPLETE"],
            whyItMatters: isImportError
              ? "Hallucinated or broken imports indicate structural coupling errors, missing package dependencies, or incorrect file paths. These compile-time faults block production deployments."
              : "TypeScript compiler diagnostics indicate types violations or syntax errors that undermine type safety, leading to runtime undefined-variable crashes and unpredictable behaviors.",
            recommendation: isImportError
              ? `Check if the imported file exists and contains the matching export. Ensure any required package is listed in package.json dependencies.`
              : `Review the type mismatch and update typings, interfaces, or class structures to conform to compiler rules.`,
            blocking: severity === "high",
            // Compiler issues from the repo's own config are 100% true positives;
            // inferred/fallback config diagnostics carry lower confidence.
            confidence: diagnosticConfidence,
            source: "typescript",
            codeSnippet,
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
}
