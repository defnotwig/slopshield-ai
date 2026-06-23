import { Inject, Injectable, Logger } from "@nestjs/common";
import { Finding, AIReviewResult } from "@slopshield/shared";
import { AIReviewerProvider } from "./interfaces/ai-reviewer-provider.interface.js";
import { AI_REVIEWER_PROVIDER } from "./ai-reviewer.constants.js";
import { StandardsMapper } from "../rules/standards-mapper.js";

@Injectable()
export class AIReviewerService {
  private readonly logger = new Logger(AIReviewerService.name);

  constructor(
    @Inject(AI_REVIEWER_PROVIDER) private readonly provider: AIReviewerProvider,
    private readonly standardsMapper: StandardsMapper,
  ) {}

  /**
   * Reviews the code files, collects AI findings, and parses them into canonical findings structure.
   */
  public async reviewCode(
    scanId: string,
    files: {
      path: string;
      content: string;
      language: string;
      isFrontend: boolean;
      isBackend: boolean;
    }[],
    existingFindings: { title: string; severity: string; file: string }[],
  ): Promise<AIReviewResult> {
    this.logger.log(
      `Dispatching AI review for scan ID ${scanId} with ${files.length} files...`,
    );

    const result = await this.provider.reviewCode({
      scanId,
      files,
      existingFindings,
    });

    // Populate standardReferences on findings using StandardsMapper
    for (const finding of result.findings) {
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

    return result;
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
