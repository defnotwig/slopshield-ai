/**
 * Empty-repo resilience tests.
 *
 * A repository whose archive contains only excluded/binary files (no scannable
 * source) must NOT crash the scan pipeline: classification of [] yields [],
 * the orchestrator runs on [] producing no findings, and scoring on 0 findings
 * still produces a valid ScanScore with a completed (non-crashing) result.
 *
 * Rather than wiring the entire Nest pipeline, this exercises the two realistic
 * units that guarantee the "0 scannable files => valid score, no crash"
 * behaviour: FileClassifier.classifyFiles([]) and
 * ScoringService.calculateScore([]).
 *
 * Validates: Requirements 8.1, 11.4
 */
import { FileClassifier } from "@slopshield/scanner-plugins";
import { ScanStatusResultEnum } from "@slopshield/shared";
import { ScoringService } from "../scoring/scoring.service.js";

describe("empty repository scan resilience", () => {
  describe("FileClassifier.classifyFiles([])", () => {
    it("returns an empty array without throwing", () => {
      const classifier = new FileClassifier();
      expect(() => classifier.classifyFiles([])).not.toThrow();
      expect(classifier.classifyFiles([])).toEqual([]);
    });
  });

  describe("ScoringService.calculateScore([])", () => {
    const scoringService = new ScoringService();

    it("produces a valid ScanScore with 0 findings (no crash)", () => {
      expect(() => scoringService.calculateScore([])).not.toThrow();
      const score = scoringService.calculateScore([]);

      // overallScore is a real number within [0, 100]
      expect(typeof score.overallScore).toBe("number");
      expect(Number.isNaN(score.overallScore)).toBe(false);
      expect(score.overallScore).toBeGreaterThanOrEqual(0);
      expect(score.overallScore).toBeLessThanOrEqual(100);

      // statusResult is one of the valid verdicts
      expect(ScanStatusResultEnum.options).toContain(score.statusResult);

      // 0 findings reported across the board
      expect(score.totalFindings).toBe(0);
      expect(score.criticalCount).toBe(0);
      expect(score.highCount).toBe(0);
      expect(score.mediumCount).toBe(0);
      expect(score.lowCount).toBe(0);
      expect(score.infoCount).toBe(0);

      // No blocking conditions for an empty findings set
      expect(score.blockedReasons).toEqual([]);
      expect(score.statusResult).not.toBe("blocked");
    });

    it("scores an empty repo as a perfect 100 / passed", () => {
      const score = scoringService.calculateScore([]);
      // With zero deductions every category stays at 100, so the weighted
      // overall is 100 and the verdict is the top band.
      expect(score.overallScore).toBe(100);
      expect(score.statusResult).toBe("passed");
    });
  });
});
