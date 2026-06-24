import * as fs from "fs";
import * as path from "path";
import { Finding } from "@slopshield/shared";
import {
  StaticAnalyzer,
  AnalysisContext,
  AnalysisResult,
} from "../interfaces/static-analyzer.interface.js";

type DepFinding = Omit<Finding, "id" | "scanId">;

/**
 * Minimal bundled advisory list: package -> the first SAFE version. Any installed
 * version below this is flagged. Intentionally small and offline; a real
 * deployment would sync this from an advisory feed. Keeps the scanner useful
 * without network access on the host (e.g. Render).
 */
const KNOWN_VULNERABLE: Record<string, { safeFrom: string; note: string }> = {
  lodash: { safeFrom: "4.17.21", note: "Prototype pollution (CVE-2021-23337 and earlier)." },
  axios: { safeFrom: "1.6.0", note: "SSRF / credential leak fixes (multiple CVEs)." },
  "node-fetch": { safeFrom: "2.6.7", note: "Exposure of sensitive information (CVE-2022-0235)." },
  minimist: { safeFrom: "1.2.6", note: "Prototype pollution (CVE-2021-44906)." },
  "json5": { safeFrom: "2.2.2", note: "Prototype pollution (CVE-2022-46175)." },
  "ws": { safeFrom: "7.4.6", note: "ReDoS in header parsing (CVE-2021-32640)." },
  "semver": { safeFrom: "7.5.2", note: "ReDoS in range parsing (CVE-2022-25883)." },
  "follow-redirects": { safeFrom: "1.15.6", note: "Sensitive header / URL leakage (multiple CVEs)." },
  "tar": { safeFrom: "6.1.9", note: "Arbitrary file write / path traversal." },
  "qs": { safeFrom: "6.5.3", note: "Prototype pollution (CVE-2022-24999)." },
};

/** Popular packages used as the typosquatting reference set. */
const POPULAR_PACKAGES = [
  "react",
  "react-dom",
  "lodash",
  "axios",
  "express",
  "next",
  "typescript",
  "chalk",
  "commander",
  "moment",
  "dotenv",
  "uuid",
  "zod",
  "prisma",
  "jsonwebtoken",
];

export class DependencyAnalyzer implements StaticAnalyzer {
  public readonly name = "dependency-scanner";
  public readonly description =
    "Flags known-vulnerable, unstable, and typosquatted dependencies in package.json";

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    const startTime = Date.now();
    const findings: DepFinding[] = [];

    try {
      const manifests = context.files.filter(
        (f) => path.basename(f).toLowerCase() === "package.json",
      );

      for (const manifest of manifests) {
        const abs = path.join(context.scanDir, manifest);
        let parsed: any;
        try {
          parsed = JSON.parse(await fs.promises.readFile(abs, "utf8"));
        } catch {
          continue; // malformed package.json — not this analyzer's job to fail
        }

        const deps: Record<string, string> = {
          ...(parsed.dependencies ?? {}),
          ...(parsed.devDependencies ?? {}),
        };

        for (const [name, range] of Object.entries(deps)) {
          this.checkKnownVulnerable(manifest, name, range, findings);
          this.checkUnstable(manifest, name, range, findings);
          this.checkTyposquat(manifest, name, findings);
        }
      }

      return {
        analyzerName: this.name,
        success: true,
        findings,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        analyzerName: this.name,
        success: false,
        findings: [],
        error: err.message || String(err),
        durationMs: Date.now() - startTime,
      };
    }
  }

  private checkKnownVulnerable(
    file: string,
    name: string,
    range: string,
    findings: DepFinding[],
  ): void {
    const advisory = KNOWN_VULNERABLE[name];
    if (!advisory) {
      return;
    }
    const installed = this.coerceVersion(range);
    if (installed && this.lessThan(installed, advisory.safeFrom)) {
      findings.push({
        severity: "high",
        category: "backend-security",
        title: `Vulnerable Dependency: ${name}@${range}`,
        file,
        standardReferences: ["OWASP_TOP_10", "CWE_TOP_25", "NIST_SSDF"],
        whyItMatters: `${name} ${range} is below the first patched version (${advisory.safeFrom}). ${advisory.note}`,
        recommendation: `Upgrade ${name} to >= ${advisory.safeFrom}.`,
        blocking: true,
        confidence: 0.9,
        source: "dependency",
      });
    }
  }

  private checkUnstable(
    file: string,
    name: string,
    range: string,
    findings: DepFinding[],
  ): void {
    const version = this.coerceVersion(range);
    if (version && version.startsWith("0.")) {
      findings.push({
        severity: "low",
        category: "reliability",
        title: `Pre-1.0 Dependency: ${name}@${range}`,
        file,
        standardReferences: ["NIST_SSDF"],
        whyItMatters: `${name} is on a 0.x release, where breaking changes can land in any minor bump. Pinning to an unstable major is risky for production.`,
        recommendation: `Pin ${name} to an exact version or track a 1.x+ release when available.`,
        blocking: false,
        confidence: 0.6,
        source: "dependency",
      });
    }
  }

  private checkTyposquat(
    file: string,
    name: string,
    findings: DepFinding[],
  ): void {
    if (name.startsWith("@") || POPULAR_PACKAGES.includes(name)) {
      return;
    }
    for (const popular of POPULAR_PACKAGES) {
      if (this.editDistance(name, popular) === 1) {
        findings.push({
          severity: "high",
          category: "backend-security",
          title: `Possible Typosquat: ${name}`,
          file,
          standardReferences: ["OWASP_TOP_10", "NIST_SSDF"],
          whyItMatters: `Dependency "${name}" is one character away from the popular package "${popular}". Typosquatted packages are a common supply-chain attack vector.`,
          recommendation: `Verify "${name}" is intentional; if you meant "${popular}", correct it.`,
          blocking: false,
          confidence: 0.7,
          source: "dependency",
        });
        return;
      }
    }
  }

  /** Strip range operators and return a clean x.y.z string, or null. */
  private coerceVersion(range: string): string | null {
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(range);
    if (m) {
      return `${m[1]}.${m[2]}.${m[3]}`;
    }
    const partial = /(\d+)\.(\d+)/.exec(range);
    return partial ? `${partial[1]}.${partial[2]}.0` : null;
  }

  private lessThan(a: string, b: string): boolean {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const da = pa[i] ?? 0;
      const db = pb[i] ?? 0;
      if (da !== db) {
        return da < db;
      }
    }
    return false;
  }

  /** Levenshtein edit distance (small inputs). */
  private editDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] =
          a[i - 1] === b[j - 1]
            ? prev
            : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return dp[n];
  }
}
