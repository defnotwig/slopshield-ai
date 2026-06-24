import { Inject, Injectable, Logger } from "@nestjs/common";
import { Finding, AIReviewResult } from "@slopshield/shared";
import { AIReviewerProvider } from "./interfaces/ai-reviewer-provider.interface.js";
import { AI_REVIEWER_PROVIDER } from "./ai-reviewer.constants.js";
import { StandardsMapper } from "../rules/standards-mapper.js";
import {
  ReviewFile,
  TokenUsage,
  batchFilesByDirectory,
  mergeAIReviewResults,
  sumTokenUsage,
  emptyReviewResult,
  withTimeout,
  mapWithConcurrency,
} from "./ai-review.util.js";

/** Result of a (batched) review plus observability metadata for ScanMetrics. */
export type AIReviewServiceResult = AIReviewResult & {
  usage?: TokenUsage;
  batchCount: number;
};

@Injectable()
export class AIReviewerService {
  private readonly logger = new Logger(AIReviewerService.name);

  private readonly batchSize = Number(process.env.AI_BATCH_SIZE ?? 4);
  private readonly batchConcurrency = Number(
    process.env.AI_BATCH_CONCURRENCY ?? 4,
  );
  private readonly batchTimeoutMs = Number(
    process.env.AI_BATCH_TIMEOUT_MS ?? 25_000,
  );

  constructor(
    @Inject(AI_REVIEWER_PROVIDER) private readonly provider: AIReviewerProvider,
    private readonly standardsMapper: StandardsMapper,
  ) {}

  /**
   * Reviews the code files and parses them into the canonical findings shape.
   *
   * Files are split into directory-grouped batches that are reviewed
   * concurrently (bounded by `AI_BATCH_CONCURRENCY`), each batch bounded by
   * `AI_BATCH_TIMEOUT_MS`. Turning one long serial prompt into several short
   * parallel ones is the single biggest scan-latency win. Per-batch failures or
   * timeouts degrade to an empty result for that batch instead of failing the
   * whole review.
   */
  public async reviewCode(
    scanId: string,
    files: ReviewFile[],
    existingFindings: { title: string; severity: string; file: string }[],
  ): Promise<AIReviewServiceResult> {
    const batches = batchFilesByDirectory(files, this.batchSize);
    this.logger.log(
      `Dispatching AI review for scan ID ${scanId}: ${files.length} files across ${batches.length} batch(es), concurrency ${this.batchConcurrency}.`,
    );

    const batchResults = await mapWithConcurrency(
      batches,
      this.batchConcurrency,
      (batch, index) =>
        withTimeout(
          this.provider
            .reviewCode({ scanId, files: batch, existingFindings })
            .catch((err: any) => {
              this.logger.warn(
                `AI review batch ${index + 1}/${batches.length} failed: ${err?.message ?? err}`,
              );
              return emptyReviewResult();
            }),
          this.batchTimeoutMs,
          () => {
            this.logger.warn(
              `AI review batch ${index + 1}/${batches.length} timed out after ${this.batchTimeoutMs}ms.`,
            );
            return emptyReviewResult();
          },
        ),
    );

    const merged = mergeAIReviewResults(batchResults);
    const usage = sumTokenUsage(batchResults.map((r) => r.usage));

    // Populate the principal standard on findings using StandardsMapper.
    for (const finding of merged.findings) {
      if (!finding.standard) {
        const mapped = this.standardsMapper.mapFindingToStandards({
          title: finding.title,
          category: finding.category,
          description: finding.why_it_matters,
        });
        if (mapped.length > 0) {
          finding.standard = mapped[0]; // Set principal standard
        }
      }
    }

    return { ...merged, usage, batchCount: batches.length };
  }

  /**
   * Generates a step-by-step fix plan based on the findings list and file content context.
   */
  public async generateFixPlan(
    findings: Finding[],
    codeContext: string,
  ): Promise<string[]> {
    return this.provider.generateFixPlan(findings, codeContext);
  }

  /**
   * Generates an executive summary of a scan report suitable for notifications.
   */
  public async summarize(scanReport: any): Promise<string> {
    return this.provider.summarizeForLark(scanReport);
  }
}
