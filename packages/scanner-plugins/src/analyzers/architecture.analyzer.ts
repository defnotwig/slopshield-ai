import * as fs from "fs";
import * as path from "path";
import { Finding, FindingSeverity, FindingCategory } from "@slopshield/shared";
import {
  StaticAnalyzer,
  AnalysisContext,
  AnalysisResult,
} from "../interfaces/static-analyzer.interface.js";

type ArchFinding = Omit<Finding, "id" | "scanId">;

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const RESOLVE_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];
const HIGH_COUPLING_THRESHOLD = Number(process.env.ARCH_COUPLING_THRESHOLD ?? 12);
const GOD_FILE_LINES = Number(process.env.ARCH_GOD_FILE_LINES ?? 500);

/**
 * Architecture analyzer: detects structural smells that AI-generated code tends
 * to introduce — circular imports, high coupling, god files, barrel re-exports,
 * and layering violations (controllers reaching into repositories). Builds a
 * lightweight relative-import graph from the scanned files.
 */
export class ArchitectureAnalyzer implements StaticAnalyzer {
  public readonly name = "architecture-scanner";
  public readonly description =
    "Detects circular imports, high coupling, god files, barrel files, and layering violations";

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    const startTime = Date.now();
    const findings: ArchFinding[] = [];

    try {
      const codeFiles = context.files.filter((f) =>
        CODE_EXTS.has(path.extname(f).toLowerCase()),
      );
      const fileKeys = new Set(codeFiles.map((f) => this.normalizeKey(f)));
      const graph = new Map<string, Set<string>>();

      for (const file of codeFiles) {
        const abs = path.join(context.scanDir, file);
        let content: string;
        try {
          content = await fs.promises.readFile(abs, "utf8");
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);

        // Per-file structural checks.
        this.checkGodFile(file, lines, findings);
        this.checkBarrelFile(file, lines, findings);
        this.checkLayering(file, content, findings);

        // Import graph edges (relative imports only).
        const imports = this.extractRelativeImports(content);
        this.checkCoupling(file, content, findings);

        const fromKey = this.normalizeKey(file);
        const targets = new Set<string>();
        for (const spec of imports) {
          const resolved = this.resolveImport(file, spec, fileKeys);
          if (resolved && resolved !== fromKey) {
            targets.add(resolved);
          }
        }
        graph.set(fromKey, targets);
      }

      this.detectCycles(graph, findings);

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

  private normalizeKey(file: string): string {
    return file
      .replaceAll("\\", "/")
      .replace(/\.(tsx?|jsx?)$/i, "")
      .replace(/\/index$/i, "");
  }

  private extractRelativeImports(content: string): string[] {
    const specs: string[] = [];
    const importRe = /import\s+(?:[^'"]*?from\s+)?['"](\.[^'"]+)['"]/g;
    const requireRe = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(content)) !== null) {
      specs.push(m[1]);
    }
    while ((m = requireRe.exec(content)) !== null) {
      specs.push(m[1]);
    }
    return specs;
  }

  private resolveImport(
    importer: string,
    spec: string,
    fileKeys: Set<string>,
  ): string | null {
    const dir = path.posix.dirname(importer.replaceAll("\\", "/"));
    const joined = path.posix
      .normalize(`${dir}/${spec.replace(/\.js$/, "")}`)
      .replace(/\/$/, "");
    for (const ext of RESOLVE_EXTS) {
      const candidate = this.normalizeKey(`${joined}${ext}`);
      if (fileKeys.has(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private checkGodFile(
    file: string,
    lines: string[],
    findings: ArchFinding[],
  ): void {
    if (lines.length > GOD_FILE_LINES) {
      findings.push(
        this.finding(
          "God File",
          "medium",
          "backend-architecture",
          ["PHILOSOPHY_SOFTWARE_DESIGN", "CODE_COMPLETE"],
          file,
          `File is ${lines.length} lines (> ${GOD_FILE_LINES}). Oversized modules accumulate unrelated responsibilities and become change bottlenecks.`,
          "Split the file along its responsibilities into focused modules.",
        ),
      );
    }
  }

  private checkBarrelFile(
    file: string,
    lines: string[],
    findings: ArchFinding[],
  ): void {
    const base = path.basename(file).toLowerCase();
    if (!base.startsWith("index.")) {
      return;
    }
    const codeLines = lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*"));
    if (codeLines.length < 5) {
      return;
    }
    const reexportLines = codeLines.filter((l) => /^export\s+(?:\*|\{)/.test(l));
    if (reexportLines.length >= codeLines.length * 0.9) {
      findings.push(
        this.finding(
          "Barrel File",
          "low",
          "backend-architecture",
          ["PHILOSOPHY_SOFTWARE_DESIGN"],
          file,
          `index file re-exports ${reexportLines.length} symbols. Large barrels create implicit coupling, hurt tree-shaking, and can cause circular imports.`,
          "Import from concrete modules instead of a catch-all barrel.",
        ),
      );
    }
  }

  private checkLayering(
    file: string,
    content: string,
    findings: ArchFinding[],
  ): void {
    const lower = file.toLowerCase();
    const isController =
      lower.includes(".controller.") || lower.includes("/controllers/");
    if (
      isController &&
      /from\s+['"][^'"]*(?:repository|repositories|\.repo)['"]/i.test(content)
    ) {
      findings.push(
        this.finding(
          "Layering Violation: Controller imports Repository",
          "medium",
          "backend-architecture",
          ["PHILOSOPHY_SOFTWARE_DESIGN", "CLEAN_CODE"],
          file,
          "A controller imports a repository directly, bypassing the service layer. This couples transport concerns to data access and undermines testability.",
          "Route data access through a service; keep controllers thin.",
        ),
      );
    }
  }

  private checkCoupling(
    file: string,
    content: string,
    findings: ArchFinding[],
  ): void {
    const importCount = (content.match(/^\s*import\s/gm) ?? []).length;
    if (importCount > HIGH_COUPLING_THRESHOLD) {
      findings.push(
        this.finding(
          "High Coupling",
          "low",
          "backend-architecture",
          ["PHILOSOPHY_SOFTWARE_DESIGN", "CODE_COMPLETE"],
          file,
          `File has ${importCount} imports (> ${HIGH_COUPLING_THRESHOLD}). High fan-in coupling makes the module fragile and hard to reuse.`,
          "Reduce dependencies — apply dependency inversion or split responsibilities.",
        ),
      );
    }
  }

  /** Detect import cycles via DFS, reporting each distinct cycle once. */
  private detectCycles(
    graph: Map<string, Set<string>>,
    findings: ArchFinding[],
  ): void {
    const state = new Map<string, number>(); // 0=unvisited,1=onstack,2=done
    const stack: string[] = [];
    const reported = new Set<string>();

    const visit = (node: string): void => {
      state.set(node, 1);
      stack.push(node);
      for (const next of graph.get(node) ?? []) {
        const s = state.get(next) ?? 0;
        if (s === 0) {
          visit(next);
        } else if (s === 1) {
          const idx = stack.indexOf(next);
          if (idx !== -1) {
            const cycle = stack.slice(idx);
            const canonical = [...cycle].sort((a, b) => a.localeCompare(b)).join("|");
            if (!reported.has(canonical) && cycle.length > 1) {
              reported.add(canonical);
              findings.push(
                this.finding(
                  "Circular Import",
                  "medium",
                  "backend-architecture",
                  ["PHILOSOPHY_SOFTWARE_DESIGN", "CODE_COMPLETE"],
                  `${cycle[0]}.ts`,
                  `Circular import detected: ${cycle.join(" → ")} → ${cycle[0]}. Cycles cause fragile init order and tight coupling.`,
                  "Break the cycle by extracting shared code into a third module or inverting a dependency.",
                ),
              );
            }
          }
        }
      }
      stack.pop();
      state.set(node, 2);
    };

    for (const node of graph.keys()) {
      if ((state.get(node) ?? 0) === 0) {
        visit(node);
      }
    }
  }

  private finding(
    title: string,
    severity: FindingSeverity,
    category: FindingCategory,
    standardReferences: string[],
    file: string,
    whyItMatters: string,
    recommendation: string,
  ): ArchFinding {
    return {
      severity,
      category,
      title,
      file,
      standardReferences,
      whyItMatters,
      recommendation,
      blocking: false,
      confidence: 0.75,
      source: "architecture",
    };
  }
}
