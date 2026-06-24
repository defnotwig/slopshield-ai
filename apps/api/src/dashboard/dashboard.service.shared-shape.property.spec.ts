// Feature: production-grade-system, Property 24: Dashboard endpoints return shared-conformant shapes
//
// Property 24: Dashboard endpoints return shared-conformant shapes.
// Validates: Requirements 8.1, 8.2
//
// For any set of scans and findings, the responses of the dashboard summary,
// trend, top-issues, and standards endpoints parse successfully against their
// shared Zod schemas (DashboardSummary, DashboardTrendPoint, TopIssue,
// StandardViolation). This is the regression guard for audit finding A2 — the
// dashboard shape mismatch between the API payloads and the shared contract.
//
// Strategy: fast-check generates realistic underlying ScanJob and Finding
// records (status, verdict, overallScore, category, falsePositive,
// standardReference, projectId). Those records back a deterministic in-memory
// Prisma fake that implements exactly the query surface DashboardService uses
// (scanJob.count / scanJob.findMany / finding.groupBy / finding.findMany with
// their where/select/orderBy/take semantics). The REAL DashboardService is then
// driven against the fake and every endpoint's output is parsed against the
// shared schema. The service is also exercised with and without a projectId
// filter so both code paths are covered.

import fc from "fast-check";

import { DashboardService } from "./dashboard.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  DashboardSummarySchema,
  DashboardTrendPointSchema,
  TopIssueSchema,
  StandardViolationSchema,
} from "@slopshield/shared";

// ---------------------------------------------------------------------------
// Generated record shapes
// ---------------------------------------------------------------------------

interface ScanRow {
  id: string;
  projectId: string;
  status: string;
  statusResult: string | null;
  overallScore: number | null;
  createdAt: Date;
}

interface FindingRow {
  id: string;
  scanProjectId: string;
  category: string;
  falsePositive: boolean;
  standardReferences: string[];
}

// Valid shared FindingCategory values — TopIssue.category must be one of these.
const CATEGORIES = [
  "backend-security",
  "frontend-security",
  "backend-architecture",
  "frontend-architecture",
  "maintainability",
  "testability",
  "accessibility",
  "reliability",
  "documentation",
  "general",
] as const;

const SCAN_STATUSES = ["queued", "running", "completed", "failed"] as const;
const VERDICTS = [
  "blocked",
  "passed",
  "passed-with-warnings",
  "needs-cleanup",
  "risky",
  null,
] as const;

// ---------------------------------------------------------------------------
// where-clause matchers mirroring Prisma semantics for the fields the service
// actually filters on.
// ---------------------------------------------------------------------------

function matchScanWhere(scan: ScanRow, where: any): boolean {
  if (!where) return true;
  if (where.projectId !== undefined && scan.projectId !== where.projectId) {
    return false;
  }
  if (where.status !== undefined && scan.status !== where.status) {
    return false;
  }
  if (where.overallScore !== undefined) {
    // The service only ever uses `{ not: null }`.
    if (where.overallScore.not === null && scan.overallScore === null) {
      return false;
    }
  }
  if (where.statusResult !== undefined) {
    const sr = where.statusResult;
    if (typeof sr === "string") {
      if (scan.statusResult !== sr) return false;
    } else if (sr && Array.isArray(sr.in)) {
      if (scan.statusResult === null || !sr.in.includes(scan.statusResult)) {
        return false;
      }
    }
  }
  return true;
}

function matchFindingWhere(finding: FindingRow, where: any): boolean {
  if (!where) return true;
  if (where.scanJob && where.scanJob.projectId !== undefined) {
    if (finding.scanProjectId !== where.scanJob.projectId) return false;
  }
  if (where.falsePositive !== undefined) {
    if (finding.falsePositive !== where.falsePositive) return false;
  }
  if (where.standardReferences !== undefined) {
    // The service uses `{ isEmpty: false }` to require at least one standard.
    if (
      where.standardReferences.isEmpty === false &&
      finding.standardReferences.length === 0
    ) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Deterministic in-memory Prisma fake exposing only the methods the
// DashboardService calls.
// ---------------------------------------------------------------------------

function buildPrismaFake(
  scans: ScanRow[],
  findings: FindingRow[],
): PrismaService {
  const prisma = {
    scanJob: {
      count: async (args: any) =>
        scans.filter((s) => matchScanWhere(s, args?.where)).length,
      findMany: async (args: any) => {
        let rows = scans.filter((s) => matchScanWhere(s, args?.where));
        if (args?.orderBy?.createdAt === "asc") {
          rows = [...rows].sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
          );
        }
        if (typeof args?.take === "number") {
          rows = rows.slice(0, args.take);
        }
        // Return full rows; the service only reads selected fields.
        return rows;
      },
    },
    finding: {
      groupBy: async (args: any) => {
        const matched = findings.filter((f) =>
          matchFindingWhere(f, args?.where),
        );
        const counts = new Map<string, number>();
        for (const f of matched) {
          counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
        }
        const groups = [...counts.entries()].map(([category, count]) => ({
          category,
          _count: { id: count },
        }));
        if (args?.orderBy?._count?.id === "desc") {
          groups.sort((a, b) => b._count.id - a._count.id);
        }
        return groups;
      },
      findMany: async (args: any) =>
        findings
          .filter((f) => matchFindingWhere(f, args?.where))
          .map((f) => ({ standardReferences: f.standardReferences })),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as PrismaService;

  return prisma;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const projectIdArb = fc.constantFrom("proj-a", "proj-b", "proj-c");

const scanArb: fc.Arbitrary<ScanRow> = fc.record({
  id: fc.uuid(),
  projectId: projectIdArb,
  status: fc.constantFrom(...SCAN_STATUSES),
  statusResult: fc.constantFrom(...VERDICTS),
  overallScore: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
  createdAt: fc
    .integer({ min: 0, max: 1_000_000_000 })
    .map((ms) => new Date(1_700_000_000_000 + ms)),
});

const findingArb: fc.Arbitrary<FindingRow> = fc.record({
  id: fc.uuid(),
  scanProjectId: projectIdArb,
  category: fc.constantFrom(...CATEGORIES),
  falsePositive: fc.boolean(),
  standardReferences: fc.array(
    fc.constantFrom(
      "OWASP A01:2021",
      "CWE-79",
      "WCAG 2.2 SC 1.1.1",
      "OWASP A03:2021",
    ),
    { maxLength: 3 },
  ),
});

describe("DashboardService — Property 24: Dashboard endpoints return shared-conformant shapes", () => {
  it("summary / trends / top-issues / standards all parse against their shared schemas", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(scanArb, { maxLength: 40 }),
        fc.array(findingArb, { maxLength: 60 }),
        // undefined => no project filter; otherwise filter by a concrete project.
        fc.option(projectIdArb, { nil: undefined }),
        async (scans, findings, projectId) => {
          const prisma = buildPrismaFake(scans, findings);
          const service = new DashboardService(prisma);

          const summary = await service.getSummary(projectId);
          DashboardSummarySchema.parse(summary);

          const trends = await service.getTrends(projectId);
          for (const point of trends) {
            DashboardTrendPointSchema.parse(point);
          }

          const topIssues = await service.getTopIssues(projectId);
          for (const issue of topIssues) {
            TopIssueSchema.parse(issue);
          }

          const standards = await service.getStandardsViolations(projectId);
          for (const violation of standards) {
            StandardViolationSchema.parse(violation);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
