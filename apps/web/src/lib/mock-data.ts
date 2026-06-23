/**
 * Mock Data Module (`apps/web/src/lib/mock-data.ts`)
 *
 * In-memory, deterministic demo dataset typed against `@slopshield/shared`.
 * Powers every page of the web app when `config.isMock` is true.
 *
 * Design constraints (see design.md "Data Models"):
 * - Every shared-typed literal (`ScanJob`, `Finding`, `CategoryScores`,
 *   `ScanScore`, `LarkScanSummary`, `Rule`) must `.parse()` cleanly against its
 *   shared Zod schema.
 * - Dashboard aggregates must be internally consistent with the mock scans /
 *   findings (e.g. `totalScans === mockScanJobs.length`).
 * - All timestamps are FIXED ISO strings — no runtime clock — so SSR output is
 *   deterministic.
 * - Pure data only: no side effects, no `Date.now()` at module scope.
 */

import type {
  ScanJob,
  Finding,
  CategoryScores,
  ScanScore,
  LarkScanSummary,
  Rule,
  ScanStatusResult,
  DashboardSummary,
  DashboardTrendPoint,
  TopIssue,
  StandardViolation,
} from "@slopshield/shared";

// ---------------------------------------------------------------------------
// Frontend-local mock shapes (no shared schema yet — PENDING reconciliation)
// ---------------------------------------------------------------------------

/** GET /scans — paginated envelope returned to useScans(). */
export interface PaginatedScans {
  data: ScanJob[];
  page: number;
  limit: number;
  total: number;
}

// Dashboard payload shapes (`DashboardSummary`, `DashboardTrendPoint`,
// `TopIssue`, `StandardViolation`) are sourced directly from `@slopshield/shared`
// so the mock data, the API responses, and the Web_App all conform to the same
// contract (Req 8.1–8.3, resolves audit finding A2).

/** GET /projects */
export interface Project {
  id: string;
  name: string;
  repositoryUrl?: string;
  createdAt: string;
}

/** GET /users/notifications */
export interface NotificationSettings {
  larkEnabled: boolean;
  emailEnabled: boolean;
  notifyOnBlocked: boolean;
}

/** GET /auth/me */
export interface DemoUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Fixed identifiers (valid UUID v4 strings) and timestamps
// ---------------------------------------------------------------------------

const USER_ID = "c1111111-1111-4111-8111-111111111111";

const PROJECT_1 = "a1111111-1111-4111-8111-111111111111";
const PROJECT_2 = "a2222222-2222-4222-8222-222222222222";

const SCAN_1 = "b1111111-1111-4111-8111-111111111111";
const SCAN_2 = "b2222222-2222-4222-8222-222222222222";
const SCAN_3 = "b3333333-3333-4333-8333-333333333333";
const SCAN_4 = "b4444444-4444-4444-8444-444444444444";
const SCAN_5 = "b5555555-5555-4555-8555-555555555555";

// ---------------------------------------------------------------------------
// Demo user / projects / notification settings
// ---------------------------------------------------------------------------

export const mockMe: DemoUser = {
  id: USER_ID,
  name: "Demo Reviewer",
  email: "demo@slopshield.example.com",
  role: "tech-lead",
};

export const mockProjects: Project[] = [
  {
    id: PROJECT_1,
    name: "Checkout Service",
    repositoryUrl: "https://github.com/slopshield/checkout-service",
    createdAt: "2024-01-02T09:00:00.000Z",
  },
  {
    id: PROJECT_2,
    name: "Marketing Site",
    repositoryUrl: "https://github.com/slopshield/marketing-site",
    createdAt: "2024-01-08T14:30:00.000Z",
  },
];

export const mockNotificationSettings: NotificationSettings = {
  larkEnabled: true,
  emailEnabled: false,
  notifyOnBlocked: true,
};

// ---------------------------------------------------------------------------
// Scan jobs — at least three, spanning multiple statuses and verdicts
// ---------------------------------------------------------------------------

export const mockScanJobs: ScanJob[] = [
  // 1) completed + passed
  {
    id: SCAN_1,
    projectId: PROJECT_1,
    triggerType: "manual",
    sourceType: "repository",
    sourceRef: "https://github.com/slopshield/checkout-service",
    status: "completed",
    overallScore: 92,
    securityScore: 95,
    maintainabilityScore: 90,
    architectureScore: 91,
    testabilityScore: 88,
    frontendScore: 93,
    backendScore: 94,
    statusResult: "passed",
    startedBy: USER_ID,
    startedAt: "2024-01-15T10:30:00.000Z",
    completedAt: "2024-01-15T10:33:00.000Z",
    createdAt: "2024-01-15T10:30:00.000Z",
    updatedAt: "2024-01-15T10:33:00.000Z",
  },
  // 2) completed + needs-cleanup
  {
    id: SCAN_2,
    projectId: PROJECT_1,
    triggerType: "webhook",
    sourceType: "repository",
    sourceRef: "https://github.com/slopshield/checkout-service",
    status: "completed",
    overallScore: 68,
    securityScore: 72,
    maintainabilityScore: 60,
    architectureScore: 65,
    testabilityScore: 58,
    frontendScore: 70,
    backendScore: 74,
    statusResult: "needs-cleanup",
    startedBy: USER_ID,
    startedAt: "2024-01-16T08:15:00.000Z",
    completedAt: "2024-01-16T08:19:00.000Z",
    createdAt: "2024-01-16T08:15:00.000Z",
    updatedAt: "2024-01-16T08:19:00.000Z",
  },
  // 3) completed + blocked
  {
    id: SCAN_3,
    projectId: PROJECT_2,
    triggerType: "manual",
    sourceType: "paste",
    status: "completed",
    overallScore: 41,
    securityScore: 30,
    maintainabilityScore: 52,
    architectureScore: 45,
    testabilityScore: 40,
    frontendScore: 48,
    backendScore: 35,
    statusResult: "blocked",
    startedBy: USER_ID,
    startedAt: "2024-01-17T13:00:00.000Z",
    completedAt: "2024-01-17T13:05:00.000Z",
    createdAt: "2024-01-17T13:00:00.000Z",
    updatedAt: "2024-01-17T13:05:00.000Z",
  },
  // 4) in-progress (scanning) — no scores / verdict yet
  {
    id: SCAN_4,
    projectId: PROJECT_2,
    triggerType: "scheduled",
    sourceType: "repository",
    sourceRef: "https://github.com/slopshield/marketing-site",
    status: "scanning",
    startedBy: USER_ID,
    startedAt: "2024-01-18T07:45:00.000Z",
    createdAt: "2024-01-18T07:45:00.000Z",
    updatedAt: "2024-01-18T07:46:00.000Z",
  },
  // 5) failed — no scores / verdict
  {
    id: SCAN_5,
    projectId: PROJECT_1,
    triggerType: "webhook",
    sourceType: "upload",
    sourceRef: "uploads/checkout-snapshot.zip",
    status: "failed",
    startedBy: USER_ID,
    startedAt: "2024-01-18T09:00:00.000Z",
    completedAt: "2024-01-18T09:01:00.000Z",
    createdAt: "2024-01-18T09:00:00.000Z",
    updatedAt: "2024-01-18T09:01:00.000Z",
  },
];

// ---------------------------------------------------------------------------
// Findings keyed by scan id
// ---------------------------------------------------------------------------

export const mockFindingsByScanId: Record<string, Finding[]> = {
  // SCAN_1 (passed): one informational finding only
  [SCAN_1]: [
    {
      id: "finding_1_1",
      scanId: SCAN_1,
      severity: "info",
      category: "documentation",
      title: "Public function missing JSDoc",
      file: "src/lib/pricing.ts",
      line: 42,
      standardReferences: [],
      whyItMatters:
        "Undocumented public APIs slow down onboarding and invite misuse.",
      recommendation:
        "Add a short JSDoc block describing parameters and return value.",
      blocking: false,
      confidence: 0.6,
      source: "rules-engine",
    },
  ],

  // SCAN_2 (needs-cleanup): high + medium + low
  [SCAN_2]: [
    {
      id: "finding_2_1",
      scanId: SCAN_2,
      severity: "high",
      category: "frontend-security",
      title: "Unsanitized HTML rendered via dangerouslySetInnerHTML",
      file: "src/components/Comment.tsx",
      line: 88,
      standardReferences: ["OWASP A03:2021", "CWE-79"],
      whyItMatters:
        "Rendering raw user input enables stored XSS, letting attackers run scripts in other users' sessions.",
      recommendation:
        "Sanitize the input with a vetted library or render as plain text instead of HTML.",
      suggestedTests: [
        "Renders an encoded string for input containing <script> tags",
      ],
      blocking: false,
      confidence: 0.88,
      source: "semgrep",
      codeSnippet: "<div dangerouslySetInnerHTML={{ __html: comment.body }} />",
    },
    {
      id: "finding_2_2",
      scanId: SCAN_2,
      severity: "medium",
      category: "maintainability",
      title: "Function exceeds cyclomatic complexity threshold",
      file: "src/services/order.service.ts",
      line: 210,
      standardReferences: [],
      whyItMatters:
        "Highly complex functions are hard to test and a frequent source of regressions.",
      recommendation:
        "Extract the branching logic into smaller, named helpers.",
      blocking: false,
      confidence: 0.75,
      source: "eslint",
    },
    {
      id: "finding_2_3",
      scanId: SCAN_2,
      severity: "low",
      category: "testability",
      title: "Module instantiates its own dependencies",
      file: "src/services/order.service.ts",
      line: 12,
      standardReferences: [],
      whyItMatters:
        "Hard-wired dependencies make the module difficult to unit test in isolation.",
      recommendation: "Inject dependencies through the constructor.",
      blocking: false,
      confidence: 0.55,
      source: "ai-reviewer",
    },
  ],

  // SCAN_3 (blocked): critical (blocking) + high + medium
  [SCAN_3]: [
    {
      id: "finding_3_1",
      scanId: SCAN_3,
      severity: "critical",
      category: "backend-security",
      title: "Hardcoded API secret committed to source",
      file: "src/config/secrets.ts",
      line: 5,
      standardReferences: ["OWASP A07:2021", "CWE-798"],
      whyItMatters:
        "A leaked secret in version control can be exploited to access production systems.",
      recommendation:
        "Remove the secret, rotate the credential, and load it from an environment variable.",
      suggestedTests: [
        "Secret scanner reports zero findings on the config directory",
      ],
      blocking: true,
      confidence: 0.97,
      source: "secret-scanner",
      // Redacted in the demo payload — a real scanner masks detected secrets in
      // its UI, and an unmasked key-like literal trips upstream secret scanners.
      codeSnippet: 'const API_KEY = "sk_live_****************REDACTED";',
    },
    {
      id: "finding_3_2",
      scanId: SCAN_3,
      severity: "high",
      category: "backend-architecture",
      title: "SQL query built via string concatenation",
      file: "src/db/users.repository.ts",
      line: 134,
      standardReferences: ["OWASP A03:2021", "CWE-89"],
      whyItMatters:
        "String-concatenated queries are vulnerable to SQL injection.",
      recommendation: "Use parameterized queries or a query builder.",
      blocking: false,
      confidence: 0.9,
      source: "semgrep",
    },
    {
      id: "finding_3_3",
      scanId: SCAN_3,
      severity: "medium",
      category: "reliability",
      title: "Promise rejection not handled",
      file: "src/jobs/sync.job.ts",
      line: 57,
      standardReferences: [],
      whyItMatters:
        "Unhandled rejections can crash the worker process and silently drop jobs.",
      recommendation: "Wrap the awaited call in try/catch and log failures.",
      blocking: false,
      confidence: 0.7,
      source: "typescript",
    },
  ],

  // SCAN_4 (scanning) and SCAN_5 (failed): no findings yet
  [SCAN_4]: [],
  [SCAN_5]: [],
};

// ---------------------------------------------------------------------------
// Category scores + full scan scores (completed scans only)
// ---------------------------------------------------------------------------

export const mockCategoryScoresByScanId: Record<string, CategoryScores> = {
  [SCAN_1]: {
    security: 95,
    maintainability: 90,
    architecture: 91,
    testability: 88,
    frontend: 93,
    reliability: 94,
    documentation: 85,
  },
  [SCAN_2]: {
    security: 72,
    maintainability: 60,
    architecture: 65,
    testability: 58,
    frontend: 70,
    reliability: 74,
    documentation: 66,
  },
  [SCAN_3]: {
    security: 30,
    maintainability: 52,
    architecture: 45,
    testability: 40,
    frontend: 48,
    reliability: 38,
    documentation: 50,
  },
};

export const mockScanScoreByScanId: Record<string, ScanScore> = {
  [SCAN_1]: {
    overallScore: 92,
    categoryScores: mockCategoryScoresByScanId[SCAN_1],
    statusResult: "passed",
    blockedReasons: [],
    totalFindings: 1,
    criticalCount: 0,
    highCount: 0,
    mediumCount: 0,
    lowCount: 0,
    infoCount: 1,
  },
  [SCAN_2]: {
    overallScore: 68,
    categoryScores: mockCategoryScoresByScanId[SCAN_2],
    statusResult: "needs-cleanup",
    blockedReasons: [],
    totalFindings: 3,
    criticalCount: 0,
    highCount: 1,
    mediumCount: 1,
    lowCount: 1,
    infoCount: 0,
  },
  [SCAN_3]: {
    overallScore: 41,
    categoryScores: mockCategoryScoresByScanId[SCAN_3],
    statusResult: "blocked",
    blockedReasons: [
      "Critical finding: Hardcoded API secret committed to source",
    ],
    totalFindings: 3,
    criticalCount: 1,
    highCount: 1,
    mediumCount: 1,
    lowCount: 0,
    infoCount: 0,
  },
};

// ---------------------------------------------------------------------------
// Lark scan summary preview
// ---------------------------------------------------------------------------

export const mockLarkCardPreview: LarkScanSummary = {
  scanId: SCAN_3,
  repository: "slopshield/marketing-site",
  prNumber: "248",
  author: "Demo Reviewer",
  score: 41,
  status: "blocked",
  topFindings: [
    { title: "Hardcoded API secret committed to source", severity: "critical" },
    { title: "SQL query built via string concatenation", severity: "high" },
    { title: "Promise rejection not handled", severity: "medium" },
  ],
  reportUrl: `https://slopshield.example.com/scans/${SCAN_3}`,
};

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const mockRules: Rule[] = [
  {
    rule_id: "SS-SEC-001",
    title: "Hardcoded Secret Detected",
    category: "backend-security",
    severity: "critical",
    applies_to: ["backend", "general"],
    standards: ["OWASP A07:2021", "CWE-798"],
    blocking: true,
    description:
      "Detects credentials, API keys, or tokens committed directly into source code.",
    detection: {
      patterns: [
        String.raw`(api|secret|access)[_-]?key\s*=\s*['"]`,
        "sk_live_[0-9a-zA-Z]+",
      ],
    },
    recommendation:
      "Move the secret to an environment variable and rotate the exposed credential.",
    enabled: true,
  },
  {
    rule_id: "SS-SEC-002",
    title: "SQL Injection via String Concatenation",
    category: "backend-security",
    severity: "high",
    applies_to: ["backend"],
    standards: ["OWASP A03:2021", "CWE-89"],
    blocking: false,
    description:
      "Flags database queries assembled through string concatenation of untrusted input.",
    recommendation: "Use parameterized queries or a query builder.",
    enabled: true,
  },
  {
    rule_id: "SS-FE-001",
    title: "Unsafe HTML Injection",
    category: "frontend-security",
    severity: "high",
    applies_to: ["frontend"],
    standards: ["OWASP A03:2021", "CWE-79"],
    blocking: false,
    description:
      "Detects rendering of unsanitized user input via dangerouslySetInnerHTML or innerHTML.",
    recommendation: "Sanitize input or render as plain text.",
    enabled: true,
  },
  {
    rule_id: "SS-MNT-001",
    title: "Excessive Cyclomatic Complexity",
    category: "maintainability",
    severity: "medium",
    applies_to: ["general"],
    standards: [],
    blocking: false,
    description:
      "Flags functions whose cyclomatic complexity exceeds the configured threshold.",
    recommendation: "Decompose the function into smaller, focused helpers.",
    enabled: true,
  },
];

// ---------------------------------------------------------------------------
// Dashboard aggregates — derived from the mock data above for consistency
// ---------------------------------------------------------------------------

const completedScansWithScore = mockScanJobs.filter(
  (s): s is ScanJob & { overallScore: number } =>
    typeof s.overallScore === "number",
);

const verdictCounts = mockScanJobs.reduce<Record<string, number>>(
  (acc, scan) => {
    if (scan.statusResult) {
      acc[scan.statusResult] = (acc[scan.statusResult] ?? 0) + 1;
    }
    return acc;
  },
  {},
);

const averageOverallScore =
  completedScansWithScore.length === 0
    ? 0
    : Math.round(
        completedScansWithScore.reduce((sum, s) => sum + s.overallScore, 0) /
          completedScansWithScore.length,
      );

export const mockDashboardSummary: DashboardSummary = {
  totalScans: mockScanJobs.length,
  averageScore: averageOverallScore,
  blockedScans: verdictCounts["blocked" satisfies ScanStatusResult] ?? 0,
  passedScans:
    (verdictCounts["passed" satisfies ScanStatusResult] ?? 0) +
    (verdictCounts["passed-with-warnings" satisfies ScanStatusResult] ?? 0),
  warningScans:
    verdictCounts["needs-cleanup" satisfies ScanStatusResult] ?? 0,
};

export const mockDashboardTrends: DashboardTrendPoint[] = [
  { scanId: SCAN_1, date: "2024-01-15", score: 92 },
  { scanId: SCAN_2, date: "2024-01-16", score: 68 },
  { scanId: SCAN_3, date: "2024-01-17", score: 41 },
];

export const mockDashboardTopIssues: TopIssue[] = [
  {
    title: "Unsafe HTML injection",
    category: "frontend-security",
    count: 1,
  },
  {
    title: "Hardcoded secret committed to source",
    category: "backend-security",
    count: 1,
  },
  {
    title: "Excessive cyclomatic complexity",
    category: "maintainability",
    count: 1,
  },
  {
    title: "Missing JSDoc on public API",
    category: "documentation",
    count: 1,
  },
];

export const mockDashboardStandards: StandardViolation[] = [
  { standard: "OWASP A01:2021", count: 1 },
  { standard: "OWASP A03:2021", count: 2 },
  { standard: "OWASP A07:2021", count: 1 },
  { standard: "CWE-79", count: 1 },
];
