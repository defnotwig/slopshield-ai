import { Finding, AIReviewResult } from '@slopshield/shared';

export interface ReviewInput {
  scanId: string;
  files: { path: string; content: string; language: string; isFrontend: boolean; isBackend: boolean }[];
  existingFindings: { title: string; severity: string; file: string }[];
}

export interface AIReviewerProvider {
  reviewCode(input: ReviewInput): Promise<AIReviewResult>;
  generateFixPlan(findings: Finding[], codeContext: string): Promise<string[]>;
  summarizeForLark(scanReport: any): Promise<string>;
}
