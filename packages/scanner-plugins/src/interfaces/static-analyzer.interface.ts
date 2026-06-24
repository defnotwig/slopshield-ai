import { Finding, CustomRule } from "@slopshield/shared";

export interface AnalysisContext {
  /** Absolute path to the directory containing files to analyze */
  scanDir: string;
  /** List of file paths relative to scanDir */
  files: string[];
  /** Scan job ID for correlation */
  scanId: string;
  /**
   * Project-defined custom rules to apply (consumed by CustomRuleAnalyzer).
   * Absent/empty means there are no custom rules for this scan.
   */
  customRules?: CustomRule[];
  /**
   * When present, only analyzers whose `name` is in this list should run. The
   * orchestrator uses it to honor `scanMode`. Absent = run all available.
   */
  enabledAnalyzers?: string[];
}

export interface AnalysisResult {
  /** Name of the analyzer that produced these results */
  analyzerName: string;
  /** Whether the analyzer ran successfully */
  success: boolean;
  /**
   * Whether the analyzer deliberately skipped (e.g. an optional external tool
   * or its rule registry is unavailable). A skipped analyzer must not fail the
   * scan; the orchestrator records it with an Analyzer_Status of `skipped`
   * rather than `failed` (Req 5.7).
   */
  skipped?: boolean;
  /** Normalized findings */
  findings: Omit<Finding, "id" | "scanId">[];
  /** Error message if the analyzer failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

export interface StaticAnalyzer {
  /** Unique name of this analyzer */
  readonly name: string;
  /** Human-readable description */
  readonly description: string;
  /** Check if this analyzer is available (e.g., binary installed) */
  isAvailable(): Promise<boolean>;
  /** Run analysis on the given context */
  analyze(context: AnalysisContext): Promise<AnalysisResult>;
}
