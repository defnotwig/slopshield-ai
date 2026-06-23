-- CreateTable
CREATE TABLE IF NOT EXISTS "connected_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "display_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connected_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "connected_accounts_user_id_idx" ON "connected_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "connected_accounts_user_id_provider_key" ON "connected_accounts"("user_id", "provider");

-- AddForeignKey
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE IF NOT EXISTS "github_installations" (
    "id" TEXT NOT NULL,
    "installation_id" INTEGER NOT NULL,
    "account_login" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "repositories" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "github_installations_installation_id_key" ON "github_installations"("installation_id");

-- CreateTable
CREATE TABLE IF NOT EXISTS "repository_configs" (
    "id" TEXT NOT NULL,
    "repo_full_name" TEXT NOT NULL,
    "installation_id" TEXT,
    "scan_threshold" INTEGER NOT NULL DEFAULT 70,
    "scan_mode" TEXT NOT NULL DEFAULT 'full',
    "auto_block_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "repository_configs_repo_full_name_key" ON "repository_configs"("repo_full_name");

-- AddForeignKey
ALTER TABLE "repository_configs" ADD CONSTRAINT "repository_configs_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "github_installations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE IF NOT EXISTS "pr_scan_metadata" (
    "id" TEXT NOT NULL,
    "scan_job_id" TEXT NOT NULL,
    "installation_id" INTEGER NOT NULL,
    "repo_full_name" TEXT NOT NULL,
    "pr_number" INTEGER NOT NULL,
    "head_sha" TEXT NOT NULL,
    "head_branch" TEXT NOT NULL,
    "comment_id" INTEGER,
    "status_posted" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pr_scan_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pr_scan_metadata_scan_job_id_key" ON "pr_scan_metadata"("scan_job_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pr_scan_metadata_repo_full_name_pr_number_idx" ON "pr_scan_metadata"("repo_full_name", "pr_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pr_scan_metadata_installation_id_idx" ON "pr_scan_metadata"("installation_id");
