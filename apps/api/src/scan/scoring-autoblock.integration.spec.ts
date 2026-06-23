/**
 * Scoring / auto-block end-to-end integration test.
 *
 * Drives the analyze -> score path end-to-end at the unit-integration level
 * (no network, no DB, no BullMQ): a temp scanDir containing a source file with
 * a realistic hardcoded AWS access key is run through the real
 * ScannerOrchestrator (which registers the real SecretAnalyzer), and the
 * resulting findings are fed into the real ScoringService.calculateScore().
 *
 * This proves:
 *   - Req 7.4: a hardcoded secret (critical, blocking finding in a security
 *     category) forces statusResult === "blocked" with a recorded blocking
 *     reason.
 *   - Req 7.6: scoring produces a persistable shape (overallScore in [0,100],
 *     per-category scores, and a Status_Result).
 *
 * Validates: Requirements 7.4, 7.6
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { Finding } from "@slopshield/shared";
import { ScannerOrchestrator } from "../scanner/scanner.orchestrator.js";
import { ScoringService } from "../scoring/scoring.service.js";

describe("scoring auto-block integration (hardcoded secret => blocked)", () => {
  let scanDir: string;

  // A realistic, random-looking AWS access key. It matches the SecretAnalyzer
  // "AWS Access Key" pattern (AKIA + 16 upper-alnum) and is NOT in the
  // boilerplate filter, so it is flagged as a blocking critical finding.
  const HARDCODED_AWS_KEY = "AKIA3KGH7BQ2XYZ9WPLM";

  beforeAll(() => {
    scanDir = fs.mkdtempSync(path.join(os.tmpdir(), "slopshield-scoring-it-"));
    const srcDir = path.join(scanDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, "secrets.ts"),
      [
        "// Configuration module with an accidentally committed credential.",
        `const AWS_KEY = "${HARDCODED_AWS_KEY}";`,
        "export const config = { awsKey: AWS_KEY };",
        "",
      ].join("\n"),
      "utf8",
    );
  });

  afterAll(() => {
    if (scanDir && fs.existsSync(scanDir)) {
      fs.rmSync(scanDir, { recursive: true, force: true });
    }
  });

  it("ends with statusResult='blocked' and produces persistable scores", async () => {
    // 1. Run the real orchestrator over the fixture file.
    const orchestrator = new ScannerOrchestrator();
    await orchestrator.onModuleInit();

    const { findings: rawFindings } = await orchestrator.runAll({
      scanDir,
      files: ["src/secrets.ts"],
      scanId: "it-2",
    });

    // 2. The secret-scanner must flag at least one blocking finding.
    const blockingFindings = rawFindings.filter((f) => f.blocking === true);
    expect(blockingFindings.length).toBeGreaterThanOrEqual(1);

    const secretFinding = blockingFindings.find(
      (f) => f.source === "secret-scanner",
    );
    expect(secretFinding).toBeDefined();
    expect(secretFinding!.severity).toBe("critical");
    // The redacted secret must not leak the full key into the title.
    expect(secretFinding!.title).not.toContain(HARDCODED_AWS_KEY);

    // 3. Map orchestrator findings (Omit<Finding,'id'|'scanId'>) into the
    //    Finding[] shape ScoringService expects by attaching id/scanId.
    const findings: Finding[] = rawFindings.map((f, i) => ({
      ...f,
      id: `it-2-finding-${i}`,
      scanId: "it-2",
    }));

    // 4. Score the findings with the real ScoringService.
    const score = new ScoringService().calculateScore(findings);

    // Req 7.4: auto-block forces a "blocked" verdict with a recorded reason.
    expect(score.statusResult).toBe("blocked");
    expect(score.blockedReasons.length).toBeGreaterThanOrEqual(1);

    // Req 7.6: persistable score shape.
    expect(typeof score.overallScore).toBe("number");
    expect(Number.isNaN(score.overallScore)).toBe(false);
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
    expect(score.overallScore).toBeLessThanOrEqual(100);
    expect(score.categoryScores).toBeDefined();
    expect(typeof score.categoryScores.security).toBe("number");
    expect(score.totalFindings).toBe(findings.length);
    expect(score.criticalCount).toBeGreaterThanOrEqual(1);
  }, 60000);
});
