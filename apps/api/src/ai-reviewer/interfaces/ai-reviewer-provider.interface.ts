import { Finding } from "@slopshield/shared";
import type { ProviderReviewResult } from "../ai-review.util.js";

export interface ReviewInput {
  scanId: string;
  files: {
    path: string;
    content: string;
    language: string;
    isFrontend: boolean;
    isBackend: boolean;
  }[];
  existingFindings: { title: string; severity: string; file: string }[];
}

export interface AIReviewerProvider {
  /**
   * Review a (possibly batched) set of files. The returned result may carry an
   * optional `usage` field with the provider's token accounting so the scan
   * pipeline can persist AI cost metrics.
   */
  reviewCode(input: ReviewInput): Promise<ProviderReviewResult>;
  generateFixPlan(findings: Finding[], codeContext: string): Promise<string[]>;
  summarizeForLark(scanReport: any): Promise<string>;
}
