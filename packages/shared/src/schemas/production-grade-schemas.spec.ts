import {
  // scan.schema (task 1.1)
  SOURCE_TYPE,
  SourceTypeEnum,
  AnalyzerStatusEnum,
  AnalyzerCoverageSchema,
  // dashboard.schema (task 1.2)
  DashboardSummarySchema,
  DashboardTrendPointSchema,
  TopIssueSchema,
  StandardViolationSchema,
  // readiness.schema (task 1.3)
  IntegrationStatusEnum,
  ReadinessReportSchema,
  // categories (task 1.3)
  CATEGORY_SCORE_SEMANTICS,
} from "../index.js";

// ---------------------------------------------------------------------------
// Task 1.1 — SOURCE_TYPE constant + analyzer coverage contract
// ---------------------------------------------------------------------------

describe("SOURCE_TYPE constant", () => {
  it("maps REPOSITORY to the literal 'repository'", () => {
    expect(SOURCE_TYPE.REPOSITORY).toBe("repository");
  });

  it("exposes the documented source-type values", () => {
    expect(SOURCE_TYPE).toEqual({
      PASTE: "paste",
      UPLOAD: "upload",
      REPOSITORY: "repository",
      DEMO_SAMPLE: "demo-sample",
    });
  });

  it("only contains values accepted by SourceTypeEnum", () => {
    for (const value of Object.values(SOURCE_TYPE)) {
      expect(SourceTypeEnum.safeParse(value).success).toBe(true);
    }
  });
});

describe("AnalyzerStatusEnum", () => {
  it.each(["ran", "skipped", "failed"])("accepts the status %s", (status) => {
    expect(AnalyzerStatusEnum.safeParse(status).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(AnalyzerStatusEnum.safeParse("pending").success).toBe(false);
  });
});

describe("AnalyzerCoverageSchema", () => {
  const valid = {
    analyzer: "eslint",
    status: "ran",
    findingCount: 3,
    durationMs: 1200,
  };

  it("parses a valid coverage record without an optional reason", () => {
    expect(AnalyzerCoverageSchema.parse(valid)).toEqual(valid);
  });

  it("parses a valid coverage record with a reason", () => {
    const withReason = { ...valid, status: "skipped", reason: "CLI missing" };
    expect(AnalyzerCoverageSchema.parse(withReason)).toEqual(withReason);
  });

  it("rejects an unknown analyzer source", () => {
    expect(
      AnalyzerCoverageSchema.safeParse({ ...valid, analyzer: "made-up" }).success,
    ).toBe(false);
  });

  it("rejects a negative finding count", () => {
    expect(
      AnalyzerCoverageSchema.safeParse({ ...valid, findingCount: -1 }).success,
    ).toBe(false);
  });

  it("rejects a non-integer duration", () => {
    expect(
      AnalyzerCoverageSchema.safeParse({ ...valid, durationMs: 12.5 }).success,
    ).toBe(false);
  });

  it("rejects a record missing required fields", () => {
    expect(AnalyzerCoverageSchema.safeParse({ analyzer: "eslint" }).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Task 1.2 — Dashboard contract types
// ---------------------------------------------------------------------------

describe("DashboardSummarySchema", () => {
  const valid = {
    totalScans: 10,
    averageScore: 82.5,
    blockedScans: 2,
    passedScans: 6,
    warningScans: 2,
  };

  it("parses a valid summary", () => {
    expect(DashboardSummarySchema.parse(valid)).toEqual(valid);
  });

  it("rejects a non-integer count", () => {
    expect(
      DashboardSummarySchema.safeParse({ ...valid, totalScans: 1.5 }).success,
    ).toBe(false);
  });

  it("rejects an average score above 100", () => {
    expect(
      DashboardSummarySchema.safeParse({ ...valid, averageScore: 101 }).success,
    ).toBe(false);
  });

  it("rejects a negative average score", () => {
    expect(
      DashboardSummarySchema.safeParse({ ...valid, averageScore: -1 }).success,
    ).toBe(false);
  });

  it("rejects a missing field", () => {
    const { warningScans, ...partial } = valid;
    expect(DashboardSummarySchema.safeParse(partial).success).toBe(false);
  });
});

describe("DashboardTrendPointSchema", () => {
  const valid = { scanId: "scan-1", date: "2024-01-15", score: 77 };

  it("parses a valid trend point", () => {
    expect(DashboardTrendPointSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a score out of range", () => {
    expect(
      DashboardTrendPointSchema.safeParse({ ...valid, score: 150 }).success,
    ).toBe(false);
  });

  it("rejects a non-string scanId", () => {
    expect(
      DashboardTrendPointSchema.safeParse({ ...valid, scanId: 5 }).success,
    ).toBe(false);
  });
});

describe("TopIssueSchema", () => {
  const valid = {
    category: "backend-security",
    title: "SQL Injection",
    count: 4,
  };

  it("parses a valid top-issue entry", () => {
    expect(TopIssueSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an unknown category", () => {
    expect(
      TopIssueSchema.safeParse({ ...valid, category: "not-a-category" }).success,
    ).toBe(false);
  });

  it("rejects a negative count", () => {
    expect(TopIssueSchema.safeParse({ ...valid, count: -2 }).success).toBe(false);
  });

  it("rejects a missing title", () => {
    const { title, ...partial } = valid;
    expect(TopIssueSchema.safeParse(partial).success).toBe(false);
  });
});

describe("StandardViolationSchema", () => {
  const valid = { standard: "OWASP A01:2021", count: 7 };

  it("parses a valid standard-violation entry", () => {
    expect(StandardViolationSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a non-integer count", () => {
    expect(
      StandardViolationSchema.safeParse({ ...valid, count: 1.2 }).success,
    ).toBe(false);
  });

  it("rejects a missing standard", () => {
    expect(StandardViolationSchema.safeParse({ count: 1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 1.3 — Readiness contract
// ---------------------------------------------------------------------------

describe("IntegrationStatusEnum", () => {
  it.each(["configured", "skipped", "error"])(
    "accepts the status %s",
    (status) => {
      expect(IntegrationStatusEnum.safeParse(status).success).toBe(true);
    },
  );

  it("rejects an unknown status", () => {
    expect(IntegrationStatusEnum.safeParse("unknown").success).toBe(false);
  });
});

describe("ReadinessReportSchema", () => {
  const valid = {
    gemini: "configured",
    githubToken: "skipped",
    lark: "error",
    githubApp: "skipped",
  };

  it("parses a valid readiness report", () => {
    expect(ReadinessReportSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a report with an invalid integration status", () => {
    expect(
      ReadinessReportSchema.safeParse({ ...valid, gemini: "on" }).success,
    ).toBe(false);
  });

  it("rejects a report missing an integration", () => {
    const { lark, ...partial } = valid;
    expect(ReadinessReportSchema.safeParse(partial).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 1.3 — Category score semantics documentation (resolves C1)
// ---------------------------------------------------------------------------

describe("CATEGORY_SCORE_SEMANTICS", () => {
  it("sources frontend directly from the accessibility raw score", () => {
    expect(CATEGORY_SCORE_SEMANTICS.frontend).toEqual({
      sources: ["accessibility"],
      derivation: "direct",
      description: expect.any(String),
    });
  });

  it("derives security as the mean of backend+frontend security", () => {
    expect(CATEGORY_SCORE_SEMANTICS.security.derivation).toBe("mean");
    expect(CATEGORY_SCORE_SEMANTICS.security.sources).toEqual([
      "backend-security",
      "frontend-security",
    ]);
  });

  it("derives architecture as the mean of backend+frontend architecture", () => {
    expect(CATEGORY_SCORE_SEMANTICS.architecture.derivation).toBe("mean");
    expect(CATEGORY_SCORE_SEMANTICS.architecture.sources).toEqual([
      "backend-architecture",
      "frontend-architecture",
    ]);
  });

  it("maps the remaining displayed categories one-to-one (direct)", () => {
    for (const key of [
      "maintainability",
      "testability",
      "reliability",
      "documentation",
    ] as const) {
      expect(CATEGORY_SCORE_SEMANTICS[key].derivation).toBe("direct");
      expect(CATEGORY_SCORE_SEMANTICS[key].sources).toEqual([key]);
    }
  });
});
