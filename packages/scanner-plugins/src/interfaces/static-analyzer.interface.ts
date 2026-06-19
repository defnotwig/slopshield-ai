import { Finding } from '@slopshield/shared';

export interface AnalysisContext {
  /** Absolute path to the directory containing files to analyze */
  scanDir: string;
  /** List of file paths relative to scanDir */
  files: string[];
  /** Scan job ID for correlation */
  scanId: string;
}

export interface AnalysisResult {
  /** Name of the analyzer that produced these results */
  analyzerName: string;
  /** Whether the analyzer ran successfully */
  success: boolean;
  /** Normalized findings */
  findings: Omit<Finding, 'id' | 'scanId'>[];
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
