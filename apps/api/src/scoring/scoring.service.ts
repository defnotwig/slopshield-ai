import { Injectable, Logger } from "@nestjs/common";
import {
  Finding,
  FindingCategory,
  FindingSeverity,
  ScanScore,
  ScanScoreSchema,
  ScanStatusResult,
  CategoryScores,
  CATEGORY_WEIGHTS,
  SEVERITY_DEDUCTIONS,
  AUTO_BLOCK_CONDITIONS,
  getScoreStatus,
} from "@slopshield/shared";

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  /**
   * Computes the overall scan score and per-category score breakdown based on findings.
   * Enforces auto-blocking conditions and maps the final verdict.
   *
   * @param findings List of detected findings in this scan
   * @returns Detailed ScanScore calculation object
   */
  public calculateScore(findings: Finding[]): ScanScore {
    const criticalCount = findings.filter(
      (f) => f.severity === "critical",
    ).length;
    const highCount = findings.filter((f) => f.severity === "high").length;
    const mediumCount = findings.filter((f) => f.severity === "medium").length;
    const lowCount = findings.filter((f) => f.severity === "low").length;
    const infoCount = findings.filter((f) => f.severity === "info").length;

    // 1. Initialize all categories to base score of 100
    const categoryScores: CategoryScores = {
      security: 100,
      maintainability: 100,
      architecture: 100,
      testability: 100,
      frontend: 100,
      reliability: 100,
      documentation: 100,
    };

    // Keep temporary internal track of raw category scores (0-100)
    const rawScores: Record<FindingCategory, number> = {
      "backend-security": 100,
      "frontend-security": 100,
      "backend-architecture": 100,
      "frontend-architecture": 100,
      maintainability: 100,
      testability: 100,
      accessibility: 100,
      reliability: 100,
      documentation: 100,
      general: 100,
    };

    // 2. Apply deductions per finding
    for (const finding of findings) {
      const deduction =
        SEVERITY_DEDUCTIONS[finding.severity as FindingSeverity] || 0;
      rawScores[finding.category as FindingCategory] = Math.max(
        0,
        rawScores[finding.category as FindingCategory] - deduction,
      );
    }

    // 3. Map raw categories back to the CategoryScores output schema fields
    // We average split categories to fit into CategoryScores fields
    categoryScores.security = Math.min(
      100,
      (rawScores["backend-security"] + rawScores["frontend-security"]) / 2,
    );
    categoryScores.architecture = Math.min(
      100,
      (rawScores["backend-architecture"] + rawScores["frontend-architecture"]) /
        2,
    );
    categoryScores.maintainability = rawScores.maintainability;
    categoryScores.testability = rawScores.testability;
    categoryScores.frontend = rawScores.accessibility; // Maps accessibility -> frontend in UI scorecard
    categoryScores.reliability = rawScores.reliability;
    categoryScores.documentation = rawScores.documentation;

    // 4. Calculate weighted overall score
    // overallScore = Sum(rawScore[cat] * weight[cat])
    let weightedSum = 0;
    for (const cat of Object.keys(rawScores) as FindingCategory[]) {
      const weight = CATEGORY_WEIGHTS[cat] || 0;
      weightedSum += rawScores[cat] * weight;
    }
    const overallScore = Math.max(0, Math.min(100, Math.round(weightedSum)));

    // 5. Evaluate Auto-Block Conditions
    const blockedReasons: string[] = [];

    // Evaluate standard automatic block rules
    for (const condition of AUTO_BLOCK_CONDITIONS) {
      // Check if any finding has a matching title/description patterns or if it is marked as blocking
      const matchesCondition = findings.some(
        (f) =>
          f.blocking &&
          (f.category === condition.category ||
            f.title.toLowerCase().includes(condition.title.toLowerCase())),
      );

      if (matchesCondition) {
        blockedReasons.push(`${condition.title}: ${condition.description}`);
      }
    }

    // Any manual blocking flag on findings defaults to blocked
    const hasManualBlock = findings.some((f) => f.blocking);
    if (hasManualBlock && blockedReasons.length === 0) {
      blockedReasons.push(
        "Scan contains critical severity or rule violations marked as blocking.",
      );
    }

    // Determine final status verdict.
    //
    // Auto-block takes absolute precedence (Req 7.3, 7.3a): if any persisted
    // finding matched an AutoBlockCondition (or was flagged blocking), the
    // verdict is "blocked" and the documented score bands are bypassed
    // entirely — band assignment is never the source of the verdict when
    // blocked. Only when there are no blocking reasons do we assign the
    // verdict from the documented SCORE_THRESHOLDS bands (Req 7.2):
    //   90–100 passed, 80–89 passed-with-warnings, 70–79 needs-cleanup,
    //   60–69 risky, 0–59 blocked.
    const statusResult: ScanStatusResult =
      blockedReasons.length > 0 ? "blocked" : getScoreStatus(overallScore);

    // Validate the output against the shared score schema (Req 7.4) so the
    // persisted/served payload is guaranteed to conform to ScanScoreSchema.
    return ScanScoreSchema.parse({
      overallScore,
      categoryScores,
      statusResult,
      blockedReasons,
      totalFindings: findings.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      infoCount,
    });
  }
}
