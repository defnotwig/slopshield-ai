// Unit tests for the batched AI-review helpers (pure functions).
//
// These guard the latency-reduction batching/merge logic that splits one large
// AI prompt into several concurrent ones and recombines the results without
// losing findings, tests, or plan steps.

import {
  dirKey,
  batchFilesByDirectory,
  dedupeStrings,
  mergeAIReviewResults,
  sumTokenUsage,
  emptyReviewResult,
} from "./ai-review.util";
import type { AIReviewResult } from "@slopshield/shared";

describe("ai-review.util", () => {
  describe("dirKey", () => {
    it("returns the parent directory, normalizing separators", () => {
      expect(dirKey("src/a/b.ts")).toBe("src/a");
      expect(dirKey("src\\a\\b.ts")).toBe("src/a");
      expect(dirKey("top.ts")).toBe(".");
    });
  });

  describe("batchFilesByDirectory", () => {
    it("groups by directory then chunks to batchSize, preserving all files", () => {
      const files = [
        { path: "a/1.ts" },
        { path: "a/2.ts" },
        { path: "a/3.ts" },
        { path: "b/1.ts" },
      ];
      const batches = batchFilesByDirectory(files, 2);
      // dir a (3 files) -> [2,1], dir b (1 file) -> [1]
      expect(batches.length).toBe(3);
      const total = batches.reduce((n, b) => n + b.length, 0);
      expect(total).toBe(4);
      // Files from different directories never share a batch.
      for (const batch of batches) {
        const dirs = new Set(batch.map((f) => dirKey(f.path)));
        expect(dirs.size).toBe(1);
      }
    });

    it("treats batchSize <= 0 as 1", () => {
      const batches = batchFilesByDirectory([{ path: "a/1.ts" }, { path: "a/2.ts" }], 0);
      expect(batches.length).toBe(2);
    });
  });

  describe("dedupeStrings", () => {
    it("removes duplicates and blanks, preserving order", () => {
      expect(dedupeStrings([" a ", "a", "", "b", "a", "c"])).toEqual([
        "a",
        "b",
        "c",
      ]);
    });
  });

  describe("mergeAIReviewResults", () => {
    const r = (over: Partial<AIReviewResult>): AIReviewResult => ({
      summary: "",
      findings: [],
      recommended_tests: [],
      refactor_plan: [],
      ...over,
    });

    it("concatenates findings and dedupes tests/plan", () => {
      const merged = mergeAIReviewResults([
        r({
          summary: "batch one",
          findings: [{ severity: "low", category: "x", title: "t1", file: "a", why_it_matters: "w", recommendation: "r", blocking: false, confidence: 0.5 } as any],
          recommended_tests: ["test A"],
          refactor_plan: ["step 1"],
        }),
        r({
          summary: "batch two",
          findings: [{ severity: "high", category: "y", title: "t2", file: "b", why_it_matters: "w", recommendation: "r", blocking: true, confidence: 0.9 } as any],
          recommended_tests: ["test A", "test B"],
          refactor_plan: ["step 1", "step 2"],
        }),
      ]);
      expect(merged.findings.length).toBe(2);
      expect(merged.recommended_tests).toEqual(["test A", "test B"]);
      expect(merged.refactor_plan).toEqual(["step 1", "step 2"]);
      expect(merged.summary).toContain("batch one");
      expect(merged.summary).toContain("batch two");
    });

    it("falls back to a default summary when all batches are empty", () => {
      const merged = mergeAIReviewResults([emptyReviewResult(), emptyReviewResult()]);
      expect(merged.findings).toEqual([]);
      expect(merged.summary).toBe("No issues identified.");
    });

    it("orders summaries so batches with findings lead", () => {
      const merged = mergeAIReviewResults([
        r({ summary: "empty batch" }),
        r({
          summary: "has findings",
          findings: [{ severity: "low", category: "x", title: "t", file: "a", why_it_matters: "w", recommendation: "r", blocking: false, confidence: 0.5 } as any],
        }),
      ]);
      expect(merged.summary.indexOf("has findings")).toBeLessThan(
        merged.summary.indexOf("empty batch"),
      );
    });
  });

  describe("sumTokenUsage", () => {
    it("sums usage, treating missing usage as zero", () => {
      expect(
        sumTokenUsage([
          { inputTokens: 10, outputTokens: 5 },
          undefined,
          { inputTokens: 3, outputTokens: 2 },
        ]),
      ).toEqual({ inputTokens: 13, outputTokens: 7 });
    });
  });
});
