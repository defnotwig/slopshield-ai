import * as fs from "fs";
import * as path from "path";
import { Finding } from "@slopshield/shared";
import {
  StaticAnalyzer,
  AnalysisContext,
  AnalysisResult,
} from "../interfaces/static-analyzer.interface.js";

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

      // Create TS compiler options
      const compilerOptions: any = {
        noEmit: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        esModuleInterop: true,
        skipLibCheck: true,
      };

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
            confidence: 1.0, // Compiler issues are 100% true positives
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
