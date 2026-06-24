-- Production hardening migration:
--  * Finding.standard_reference (single) -> standard_references (array), data-preserving
--  * ScanJob: add reliability_score / documentation_score (backfill reliability from backend_score)
--  * Project: add custom_rules JSON for the per-project custom rule engine
--  * New scan_metrics table for per-scan observability telemetry
--  * Hot-path indexes on findings / scan_jobs / scan_files / lark_events / fix_tasks

-- ---------------------------------------------------------------------------
-- Finding.standardReferences (array) with data-preserving backfill
-- ---------------------------------------------------------------------------
ALTER TABLE "findings"
  ADD COLUMN "standard_references" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "findings"
  SET "standard_references" = ARRAY["standard_reference"]
  WHERE "standard_reference" IS NOT NULL AND "standard_reference" <> '';

ALTER TABLE "findings" DROP COLUMN "standard_reference";

-- ---------------------------------------------------------------------------
-- ScanJob: reliability + documentation score columns
-- (reliability historically lived in backend_score — preserve it)
-- ---------------------------------------------------------------------------
ALTER TABLE "scan_jobs" ADD COLUMN "reliability_score" INTEGER;
ALTER TABLE "scan_jobs" ADD COLUMN "documentation_score" INTEGER;

UPDATE "scan_jobs"
  SET "reliability_score" = "backend_score"
  WHERE "backend_score" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Project: per-project custom rules
-- ---------------------------------------------------------------------------
ALTER TABLE "projects" ADD COLUMN "custom_rules" JSONB;

-- ---------------------------------------------------------------------------
-- ScanMetrics: per-scan telemetry (1:1 with scan_jobs)
-- ---------------------------------------------------------------------------
CREATE TABLE "scan_metrics" (
  "id"                     TEXT NOT NULL,
  "scan_job_id"            TEXT NOT NULL,
  "queue_wait_ms"          INTEGER,
  "fetch_ms"               INTEGER,
  "classify_ms"            INTEGER,
  "static_analysis_ms"     INTEGER,
  "ai_review_ms"           INTEGER,
  "scoring_ms"             INTEGER,
  "total_ms"               INTEGER,
  "total_files"            INTEGER,
  "classified_files"       INTEGER,
  "analyzed_files"         INTEGER,
  "static_finding_count"   INTEGER,
  "ai_finding_count"       INTEGER,
  "blocking_finding_count" INTEGER,
  "ai_input_tokens"        INTEGER,
  "ai_output_tokens"       INTEGER,
  "analyzer_breakdown"     JSONB,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scan_metrics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scan_metrics_scan_job_id_key" ON "scan_metrics"("scan_job_id");

ALTER TABLE "scan_metrics"
  ADD CONSTRAINT "scan_metrics_scan_job_id_fkey"
  FOREIGN KEY ("scan_job_id") REFERENCES "scan_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hot-path indexes
-- ---------------------------------------------------------------------------
CREATE INDEX "findings_scan_job_id_idx" ON "findings"("scan_job_id");
CREATE INDEX "findings_scan_job_id_severity_idx" ON "findings"("scan_job_id", "severity");
CREATE INDEX "findings_scan_job_id_false_positive_idx" ON "findings"("scan_job_id", "false_positive");

CREATE INDEX "scan_jobs_project_id_idx" ON "scan_jobs"("project_id");
CREATE INDEX "scan_jobs_status_idx" ON "scan_jobs"("status");
CREATE INDEX "scan_jobs_created_at_idx" ON "scan_jobs"("created_at");

CREATE INDEX "scan_files_scan_job_id_idx" ON "scan_files"("scan_job_id");

CREATE INDEX "lark_events_scan_job_id_idx" ON "lark_events"("scan_job_id");

CREATE INDEX "fix_tasks_finding_id_idx" ON "fix_tasks"("finding_id");
CREATE INDEX "fix_tasks_assigned_to_idx" ON "fix_tasks"("assigned_to");
