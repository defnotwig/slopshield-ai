-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'developer',
    "lark_user_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "repository_url" TEXT,
    "framework" TEXT,
    "minimum_score" INTEGER NOT NULL DEFAULT 80,
    "lark_chat_id" TEXT,
    "team_lead_lark_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "scan_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT,
    "trigger_type" TEXT NOT NULL DEFAULT 'manual',
    "source_type" TEXT NOT NULL,
    "source_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "overall_score" INTEGER,
    "security_score" INTEGER,
    "maintainability_score" INTEGER,
    "architecture_score" INTEGER,
    "testability_score" INTEGER,
    "frontend_score" INTEGER,
    "backend_score" INTEGER,
    "status_result" TEXT,
    "ai_summary" TEXT,
    "refactor_plan" JSONB,
    "recommended_tests" JSONB,
    "started_by" TEXT,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "scan_mode" TEXT NOT NULL DEFAULT 'full',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "scan_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "scan_jobs_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scan_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scan_job_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "language" TEXT,
    "file_type" TEXT,
    "lines_added" INTEGER,
    "lines_removed" INTEGER,
    "is_frontend" BOOLEAN NOT NULL DEFAULT false,
    "is_backend" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scan_files_scan_job_id_fkey" FOREIGN KEY ("scan_job_id") REFERENCES "scan_jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scan_job_id" TEXT NOT NULL,
    "file_path" TEXT,
    "line_number" INTEGER,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "standard_reference" TEXT,
    "recommendation" TEXT,
    "suggested_tests" JSONB,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "confidence" REAL DEFAULT 0.5,
    "source" TEXT NOT NULL,
    "code_snippet" TEXT,
    "false_positive" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "findings_scan_job_id_fkey" FOREIGN KEY ("scan_job_id") REFERENCES "scan_jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rule_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "applies_to" JSONB NOT NULL,
    "standards" JSONB NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "lark_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scan_job_id" TEXT,
    "event_type" TEXT NOT NULL,
    "message_id" TEXT,
    "chat_id" TEXT,
    "status" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lark_events_scan_job_id_fkey" FOREIGN KEY ("scan_job_id") REFERENCES "scan_jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fix_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "finding_id" TEXT NOT NULL,
    "assigned_to" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "lark_task_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "fix_tasks_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fix_tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "rules_rule_id_key" ON "rules"("rule_id");
