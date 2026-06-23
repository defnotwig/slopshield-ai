import * as fc from "fast-check";
import { GitHubAppService } from "./github-app.service.js";
import { GitHubTokenService } from "./github-token.service.js";
import { AuditService } from "../audit/audit.service.js";

/**
 * Property-based tests for score-to-status mapping.
 *
 * **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 5.6**
 *
 * Property 4: Score-to-status mapping
 * - For any score in [0,100] and threshold in [0,100]:
 *   - When statusResult !== 'blocked': score >= threshold → 'success', score < threshold → 'failure'
 *   - When statusResult === 'blocked' and autoBlockEnabled === true → always 'failure'
 *   - When statusResult === 'blocked' and autoBlockEnabled === false → score-vs-threshold based
 */
describe("Feature: github-pr-status-checks, Property 4: Score-to-status mapping", () => {
  const service = new GitHubAppService({} as GitHubTokenService, {} as AuditService, {} as any, {} as any, {} as any, {} as any);

  describe("Non-blocked: score >= threshold → success, score < threshold → failure", () => {
    it("returns 'success' when score >= threshold and statusResult is not 'blocked'", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          fc.integer({ min: 0, max: 100 }),
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s !== "blocked"),
          fc.boolean(),
          (score, threshold, statusResult, autoBlockEnabled) => {
            fc.pre(score >= threshold);
            const result = service.determineCommitStatus(score, threshold, statusResult, autoBlockEnabled);
            return result === "success";
          },
        ),
        { numRuns: 100 },
      );
    });

    it("returns 'failure' when score < threshold and statusResult is not 'blocked'", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          fc.integer({ min: 0, max: 100 }),
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s !== "blocked"),
          fc.boolean(),
          (score, threshold, statusResult, autoBlockEnabled) => {
            fc.pre(score < threshold);
            const result = service.determineCommitStatus(score, threshold, statusResult, autoBlockEnabled);
            return result === "failure";
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Blocked with autoBlock enabled: always failure", () => {
    it("returns 'failure' when statusResult === 'blocked' and autoBlockEnabled === true, regardless of score", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          fc.integer({ min: 0, max: 100 }),
          (score, threshold) => {
            const result = service.determineCommitStatus(score, threshold, "blocked", true);
            return result === "failure";
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Blocked with autoBlock disabled: score-vs-threshold based", () => {
    it("returns 'success' when statusResult === 'blocked', autoBlockEnabled === false, and score >= threshold", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          fc.integer({ min: 0, max: 100 }),
          (score, threshold) => {
            fc.pre(score >= threshold);
            const result = service.determineCommitStatus(score, threshold, "blocked", false);
            return result === "success";
          },
        ),
        { numRuns: 100 },
      );
    });

    it("returns 'failure' when statusResult === 'blocked', autoBlockEnabled === false, and score < threshold", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          fc.integer({ min: 0, max: 100 }),
          (score, threshold) => {
            fc.pre(score < threshold);
            const result = service.determineCommitStatus(score, threshold, "blocked", false);
            return result === "failure";
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
