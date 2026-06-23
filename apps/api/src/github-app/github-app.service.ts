import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import {
  InstallationEventPayload,
  InstallationReposEventPayload,
  PostCommentParams,
  PostStatusParams,
  PostStatusResult,
  PullRequestEventPayload,
  ScanResultSummary,
  SCAN_TRIGGERING_ACTIONS,
} from './types.js';
import { GitHubTokenService } from './github-token.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhookRateLimiter } from './webhook-rate-limiter.service.js';
import { RepositoryConfigService } from './repository-config.service.js';
import { loadGitHubAppConfig } from './github-app.config.js';

/**
 * Core orchestration service for the GitHub App integration.
 *
 * Contains pure utility functions for determining commit status and
 * building PR comment bodies, as well as async methods for posting
 * statuses and handling events.
 */
@Injectable()
export class GitHubAppService {
  private readonly logger = new Logger(GitHubAppService.name);

  constructor(
    private readonly tokenService: GitHubTokenService,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
    private readonly rateLimiter: WebhookRateLimiter,
    private readonly repoConfigService: RepositoryConfigService,
    @InjectQueue('scan-pipeline') private readonly scanQueue: Queue,
  ) {}

  /**
   * Determine the commit status state based on score, threshold, and auto-block.
   *
   * Pure function suitable for property testing.
   *
   * - Returns 'success' when score >= threshold and statusResult !== 'blocked'
   * - Returns 'failure' when score < threshold and statusResult !== 'blocked'
   * - Returns 'failure' when statusResult === 'blocked' and autoBlockEnabled === true
   * - Returns score-vs-threshold result when statusResult === 'blocked' and autoBlockEnabled === false
   *
   * Requirements: 3.2, 3.3, 3.4, 3.5
   */
  determineCommitStatus(
    score: number,
    threshold: number,
    statusResult: string,
    autoBlockEnabled: boolean,
  ): 'success' | 'failure' | 'error' {
    // When auto-block is triggered and enabled, always fail
    if (statusResult === 'blocked' && autoBlockEnabled) {
      return 'failure';
    }

    // Otherwise determine based on score vs threshold
    return score >= threshold ? 'success' : 'failure';
  }

  /**
   * Build the PR comment markdown body from scan results.
   *
   * Pure function suitable for property testing.
   *
   * Produces a markdown string containing:
   * 1. A header
   * 2. Overall score and verdict (statusResult)
   * 3. Severity counts summary
   * 4. Top 5 highest-severity findings (when findings exist)
   * 5. Link to full report
   *
   * Requirements: 4.1, 4.2, 4.3, 4.4
   */
  buildPrCommentBody(scanResult: ScanResultSummary): string {
    const lines: string[] = [
      // 1. Header
      '## 🛡️ SlopShield Scan Results',
      '',
      // 2. Overall score and verdict
      `**Score:** ${scanResult.overallScore}/100 | **Verdict:** ${scanResult.statusResult}`,
      '',
      // 3. Severity counts
      '### Severity Summary',
      '',
      '| Critical | High | Medium | Low | Info |',
      '|----------|------|--------|-----|------|',
      `| ${scanResult.criticalCount} | ${scanResult.highCount} | ${scanResult.mediumCount} | ${scanResult.lowCount} | ${scanResult.infoCount} |`,
      '',
    ];

    // 4. Top 5 findings (when findings exist)
    if (scanResult.findings.length > 0) {
      const topFindings = scanResult.findings.slice(0, 5);
      const findingRows = topFindings.map((finding, index) => {
        const standard = finding.standardReference ?? '—';
        return `| ${index + 1} | ${finding.title} | ${finding.severity} | ${finding.category} | ${standard} |`;
      });

      lines.push(
        '### Top Findings',
        '',
        '| # | Title | Severity | Category | Standard |',
        '|---|-------|----------|----------|----------|',
        ...findingRows,
        '',
      );
    }

    // 5. Link to full report
    lines.push(`[📋 View Full Report](${scanResult.reportUrl})`);

    return lines.join('\n');
  }

  /**
   * Handle installation created/deleted events.
   *
   * - On `created`: upserts a GitHubInstallation record with installationId,
   *   accountLogin, accountType, active=true, and repositories list.
   * - On `deleted`: marks the installation as inactive (retains historical data
   *   per Req 6.3).
   * - Records events in audit log for operator visibility.
   *
   * Requirements: 6.1, 6.2, 6.3, 6.7
   */
  async handleInstallationEvent(payload: InstallationEventPayload): Promise<void> {
    const { action, installation, repositories } = payload;
    const { id: installationId, account } = installation;
    const { login: accountLogin, type: accountType } = account;

    switch (action) {
      case 'created': {
        const repoList = repositories?.map((r) => r.full_name) ?? [];

        await this.prisma.gitHubInstallation.upsert({
          where: { installationId },
          create: {
            installationId,
            accountLogin,
            accountType,
            active: true,
            repositories: repoList,
          },
          update: {
            accountLogin,
            accountType,
            active: true,
            repositories: repoList,
          },
        });

        await this.auditService.record({
          action: 'installation.created',
          target: accountLogin,
          metadata: { installationId, accountType, repositoryCount: repoList.length },
        });

        this.logger.log(
          `Installation created: ${accountLogin} (${accountType}), ` +
            `${repoList.length} repositories`,
        );
        break;
      }

      case 'deleted': {
        // Mark inactive — DO NOT delete (retain historical data per Req 6.3)
        await this.prisma.gitHubInstallation.updateMany({
          where: { installationId },
          data: { active: false },
        });

        await this.auditService.record({
          action: 'installation.deleted',
          target: accountLogin,
          metadata: { installationId, accountType },
        });

        this.logger.log(
          `Installation deleted (marked inactive): ${accountLogin} (${accountType})`,
        );
        break;
      }

      default: {
        this.logger.debug(
          `Unhandled installation action "${action}" for ${accountLogin}`,
        );
      }
    }
  }

  /**
   * Post a new PR comment or update an existing one.
   *
   * - If `existingCommentId` is provided, PATCHes the existing comment.
   * - Otherwise, POSTs a new comment on the PR.
   * - Returns the comment ID on success, or undefined on failure.
   * - Non-blocking: logs a warning on failure but does NOT throw (Req 4.6).
   *
   * Requirements: 4.5, 4.6, 4.7
   */
  async postOrUpdatePrComment(
    params: PostCommentParams,
  ): Promise<number | undefined> {
    const { installationId, owner, repo, prNumber, body, existingCommentId } =
      params;

    let installationToken: string;
    try {
      installationToken =
        await this.tokenService.getInstallationToken(installationId);
    } catch (error) {
      this.logger.warn(
        `Failed to get installation token for PR comment ` +
          `(${owner}/${repo}#${prNumber}): ${error instanceof Error ? error.message : error}`,
      );
      return undefined;
    }

    try {
      let url: string;
      let method: string;

      if (existingCommentId) {
        // Update existing comment
        url = `https://api.github.com/repos/${owner}/${repo}/issues/comments/${existingCommentId}`;
        method = 'PATCH';
      } else {
        // Create new comment
        url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
        method = 'POST';
      }

      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `token ${installationToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ body }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.warn(
          `Failed to ${existingCommentId ? 'update' : 'post'} PR comment ` +
            `on ${owner}/${repo}#${prNumber}: ${response.status} ${response.statusText} - ${errorBody}`,
        );
        return undefined;
      }

      const data = (await response.json()) as { id: number };
      return data.id;
    } catch (error) {
      this.logger.warn(
        `Failed to ${existingCommentId ? 'update' : 'post'} PR comment ` +
          `on ${owner}/${repo}#${prNumber}: ${error instanceof Error ? error.message : error}`,
      );
      return undefined;
    }
  }

  /**
   * Post a commit status to GitHub with retry logic.
   *
   * Retries up to 3 attempts with exponential backoff (1s, 2s, 4s) on failure.
   * On final failure, logs the error and records it in the audit log for
   * operator visibility.
   *
   * Requirements: 3.6, 3.7, 7.5, 7.6
   */
  async postCommitStatus(params: PostStatusParams): Promise<PostStatusResult> {
    const { installationId, owner, repo, sha, state, description, targetUrl, context } = params;
    const maxAttempts = 3;

    let installationToken: string;
    try {
      installationToken = await this.tokenService.getInstallationToken(installationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to get installation token for commit status ` +
          `(${owner}/${repo}@${sha}): ${message}`,
      );
      await this.auditService.record({
        action: 'commit-status.token-generation-failed',
        target: `${owner}/${repo}@${sha}`,
        metadata: {
          state,
          reason: `Token generation failed: ${message}`,
          installationId,
          authError: true,
        },
      });
      return {
        success: false,
        failureReason: 'token-generation-failed',
        errorMessage: `Authentication error: ${message}`,
      };
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const url = `https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `token ${installationToken}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({
            state,
            description,
            target_url: targetUrl,
            context,
          }),
        });

        if (response.ok) {
          return { success: true }; // Success — exit immediately
        }

        const errorBody = await response.text();
        lastError = new Error(
          `GitHub API ${response.status} ${response.statusText}: ${errorBody}`,
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      // Wait with exponential backoff before next attempt (1s, 2s, 4s)
      if (attempt < maxAttempts - 1) {
        const delayMs = 1000 * Math.pow(2, attempt);
        await this.delay(delayMs);
      }
    }

    // All retries exhausted — log and record in audit log
    const errorMessage = lastError?.message ?? 'Unknown error';
    this.logger.error(
      `Failed to post commit status after ${maxAttempts} attempts ` +
        `(${owner}/${repo}@${sha}, state=${state}): ${errorMessage}`,
    );

    await this.auditService.record({
      action: 'commit-status.post-failed',
      target: `${owner}/${repo}@${sha}`,
      metadata: {
        state,
        attempts: maxAttempts,
        lastError: errorMessage,
        installationId,
      },
    });

    return {
      success: false,
      failureReason: 'api-error-after-retries',
      errorMessage,
    };
  }

  /**
   * Handle a verified pull_request event.
   *
   * Extracts PR metadata, checks installation activity and rate limits,
   * reads repository config, supersedes any existing pending scan for the
   * same PR, creates a new ScanJob + PrScanMetadata, posts a pending commit
   * status, and enqueues the scan on the BullMQ queue.
   *
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 3.1
   */
  async handlePullRequestEvent(payload: PullRequestEventPayload): Promise<void> {
    // 1. Extract fields from payload
    const installationId = payload.installation.id;
    const repoFullName = payload.repository.full_name;
    const owner = payload.repository.owner.login;
    const repoName = payload.repository.name;
    const prNumber = payload.pull_request.number;
    const headSha = payload.pull_request.head.sha;
    const headBranch = payload.pull_request.head.ref;
    const cloneUrl = payload.repository.clone_url;
    const action = payload.action;

    // 2. Check if the action is one that triggers a scan
    if (!(SCAN_TRIGGERING_ACTIONS as readonly string[]).includes(action)) {
      this.logger.debug(
        `PR event action "${action}" for ${repoFullName}#${prNumber} is not scan-triggering — ignoring.`,
      );
      return;
    }

    // 3. Verify installation is active
    const installation = await this.prisma.gitHubInstallation.findUnique({
      where: { installationId },
    });

    if (!installation || !installation.active) {
      this.logger.warn(
        `PR event for ${repoFullName}#${prNumber} — installation ${installationId} is ` +
          `${installation ? 'inactive' : 'not found'}. Skipping scan.`,
      );
      return;
    }

    // 4. Check rate limit
    const rateLimitResult = await this.rateLimiter.checkAllowed(installationId);
    if (!rateLimitResult.allowed) {
      this.logger.warn(
        `Rate limit exceeded for installation ${installationId} ` +
          `(reason: ${rateLimitResult.reason}). Skipping scan for ${repoFullName}#${prNumber}.`,
      );
      return;
    }

    // 5. Read repository config (or apply defaults)
    const repoConfig = await this.repoConfigService.getConfig(repoFullName);

    // 6. Supersession: cancel any existing pending/queued scan for same repo+PR
    const existingMetadata = await this.prisma.prScanMetadata.findMany({
      where: {
        repoFullName,
        prNumber,
      },
    });

    for (const metadata of existingMetadata) {
      // Check if the linked scan is still pending/queued
      const existingScan = await this.prisma.scanJob.findUnique({
        where: { id: metadata.scanJobId },
      });
      if (existingScan && (existingScan.status === 'queued' || existingScan.status === 'in-progress')) {
        await this.prisma.scanJob.update({
          where: { id: existingScan.id },
          data: { status: 'cancelled', completedAt: new Date() },
        });
        this.logger.log(
          `Superseded scan ${existingScan.id} for ${repoFullName}#${prNumber} (old SHA).`,
        );
      }
    }

    // 7. Create ScanJob with triggerType "github-pr"
    const sourceRef = `${cloneUrl}#${headSha}`;
    const scanJob = await this.prisma.scanJob.create({
      data: {
        sourceType: 'repository',
        sourceRef,
        triggerType: 'github-pr',
        scanMode: repoConfig.scanMode,
        status: 'queued',
      },
    });

    // 8. Create PrScanMetadata record
    await this.prisma.prScanMetadata.create({
      data: {
        scanJobId: scanJob.id,
        installationId,
        repoFullName,
        prNumber,
        headSha,
        headBranch,
      },
    });

    // 9. Post pending commit status
    const targetUrl = `${process.env.PUBLIC_WEB_URL || process.env.CORS_ORIGIN || 'http://localhost:3000'}/scans/${scanJob.id}/report`;
    await this.postCommitStatus({
      installationId,
      owner,
      repo: repoName,
      sha: headSha,
      state: 'pending',
      description: 'SlopShield scan in progress…',
      targetUrl,
      context: 'slopshield/scan',
    });

    // 10. Enqueue on scan-pipeline BullMQ queue with timeout for PR-triggered scans
    const appConfig = loadGitHubAppConfig();
    await this.scanQueue.add('process-scan', {
      scanId: scanJob.id,
      scanDir: '', // Will be resolved by the processor for repository scans
      timeoutMs: appConfig.scanTimeout * 1000, // Timeout in ms for PR-triggered scans
    });

    this.logger.log(
      `Enqueued PR scan ${scanJob.id} for ${repoFullName}#${prNumber} @ ${headSha.slice(0, 7)}`,
    );
  }

  /**
   * Handle an `installation_repositories` webhook event (added/removed).
   *
   * - On `added`: appends newly granted repository full names to the installation's
   *   repositories array, avoiding duplicates.
   * - On `removed`: removes the specified repository full names from the installation's
   *   repositories array. Removed repositories will no longer have PR events processed.
   *
   * Requirements: 6.4, 6.5
   */
  async handleInstallationRepositoriesEvent(
    payload: InstallationReposEventPayload,
  ): Promise<void> {
    const { action, installation } = payload;

    // 1. Find the GitHubInstallation by installation.id
    const existingInstallation =
      await this.prisma.gitHubInstallation.findUnique({
        where: { installationId: installation.id },
      });

    // 2. If not found, log warning and return
    if (!existingInstallation) {
      this.logger.warn(
        `Received installation_repositories event for unknown installation ${installation.id}`,
      );
      return;
    }

    let updatedRepositories: string[];

    if (action === 'added') {
      // 3. On `added`: append new repository full names, avoiding duplicates
      const reposToAdd = (payload.repositories_added ?? []).map(
        (r) => r.full_name,
      );
      const existingSet = new Set(existingInstallation.repositories);
      for (const repo of reposToAdd) {
        existingSet.add(repo);
      }
      updatedRepositories = Array.from(existingSet);
    } else {
      // 4. On `removed`: remove repository full names from the array
      const reposToRemove = new Set(
        (payload.repositories_removed ?? []).map((r) => r.full_name),
      );
      updatedRepositories = existingInstallation.repositories.filter(
        (repo) => !reposToRemove.has(repo),
      );
    }

    // 5. Save the updated installation via Prisma
    await this.prisma.gitHubInstallation.update({
      where: { installationId: installation.id },
      data: { repositories: updatedRepositories },
    });

    // 6. Log the change
    this.logger.log(
      `Installation ${installation.id}: ${action} repositories — ` +
        `now tracking ${updatedRepositories.length} repositories`,
    );
  }

  /**
   * Event handler triggered when a scan completes. Posts the final commit
   * status and PR comment for PR-triggered scans.
   *
   * Flow:
   * 1. Load PrScanMetadata by scanJobId; return early if not a PR scan.
   * 2. Load the associated ScanJob for score, status, statusResult, findings.
   * 3. Load RepositoryConfig for the repo.
   * 4. If scan failed/errored → post 'error' commit status, audit, return.
   * 5. Determine commit status via score/threshold/statusResult/autoBlock.
   * 6. Post commit status with retry logic.
   * 7. Build and post/update PR comment.
   * 8. Update PrScanMetadata with commentId and statusPosted.
   *
   * Requirements: 3.2, 3.3, 3.4, 3.5, 4.1, 7.1, 7.2, 7.3, 7.4, 7.7
   */
  @OnEvent('scan.completed')
  async onScanCompleted(event: { scanId: string }): Promise<void> {
    const { scanId } = event;

    // 1. Load PrScanMetadata — if not found, this is not a PR-triggered scan
    const metadata = await this.prisma.prScanMetadata.findUnique({
      where: { scanJobId: scanId },
    });

    if (!metadata) {
      return; // Not a PR-triggered scan — nothing to do
    }

    // 2. Load the associated ScanJob to get score, status, statusResult, findings
    const scanJob = await this.prisma.scanJob.findUnique({
      where: { id: scanId },
      include: { findings: true },
    });

    if (!scanJob) {
      this.logger.warn(`onScanCompleted: ScanJob ${scanId} not found`);
      return;
    }

    // 3. Load RepositoryConfig for the repo
    const config = await this.repoConfigService.getConfig(metadata.repoFullName);

    // Parse owner/repo from repoFullName
    const [owner, repo] = metadata.repoFullName.split('/');

    // Build target URL for commit status
    const targetUrl = `${process.env.PUBLIC_WEB_URL || process.env.CORS_ORIGIN || 'http://localhost:3000'}/scans/${scanId}/report`;

    // 4. If scan status is 'failed' or 'error' → post 'error' commit status
    if (scanJob.status === 'failed' || scanJob.status === 'error') {
      const description = scanJob.failureReason
        ? `Scan could not be completed: ${scanJob.failureReason}`
        : 'Scan could not be completed due to an internal error';

      const statusResult = await this.postCommitStatus({
        installationId: metadata.installationId,
        owner,
        repo,
        sha: metadata.headSha,
        state: 'error',
        description,
        targetUrl,
        context: 'slopshield/scan',
      });

      if (!statusResult.success && statusResult.failureReason === 'token-generation-failed') {
        this.logger.error(
          `Authentication error: cannot post error status for ${metadata.repoFullName}#${metadata.prNumber} ` +
            `(scan ${scanId}): ${statusResult.errorMessage}`,
        );
        await this.auditService.record({
          action: 'scan.status-post-auth-failure',
          target: `${metadata.repoFullName}#${metadata.prNumber}`,
          metadata: {
            scanId,
            installationId: metadata.installationId,
            headSha: metadata.headSha,
            intendedState: 'error',
            reason: statusResult.errorMessage,
          },
        });
      }

      await this.auditService.record({
        action: 'scan.failed',
        target: `${metadata.repoFullName}#${metadata.prNumber}`,
        metadata: {
          scanId,
          status: scanJob.status,
          failureReason: scanJob.failureReason,
          installationId: metadata.installationId,
        },
      });

      // Update metadata with the posted status
      await this.prisma.prScanMetadata.update({
        where: { scanJobId: scanId },
        data: { statusPosted: statusResult.success ? 'error' : 'auth-failure' },
      });

      return;
    }

    // 5. Determine commit status
    const score = scanJob.overallScore ?? 0;
    const statusResult = scanJob.statusResult ?? 'unknown';
    const state = this.determineCommitStatus(
      score,
      config.scanThreshold,
      statusResult,
      config.autoBlockEnabled,
    );

    // 6. Build description for the commit status
    const description =
      state === 'success'
        ? `Score: ${score}/100 — Passed (threshold: ${config.scanThreshold})`
        : `Score: ${score}/100 — Failed (threshold: ${config.scanThreshold})`;

    // 7. Post commit status
    const postResult = await this.postCommitStatus({
      installationId: metadata.installationId,
      owner,
      repo,
      sha: metadata.headSha,
      state,
      description,
      targetUrl,
      context: 'slopshield/scan',
    });

    // Handle token generation failure — log auth error specifically (Requirement 9.4)
    if (!postResult.success && postResult.failureReason === 'token-generation-failed') {
      this.logger.error(
        `Authentication error: cannot post status for ${metadata.repoFullName}#${metadata.prNumber} ` +
          `(scan ${scanId}): ${postResult.errorMessage}`,
      );
      await this.auditService.record({
        action: 'scan.status-post-auth-failure',
        target: `${metadata.repoFullName}#${metadata.prNumber}`,
        metadata: {
          scanId,
          installationId: metadata.installationId,
          headSha: metadata.headSha,
          intendedState: state,
          reason: postResult.errorMessage,
        },
      });

      // Update metadata to reflect auth failure
      await this.prisma.prScanMetadata.update({
        where: { scanJobId: scanId },
        data: { statusPosted: 'auth-failure' },
      });

      return;
    }

    // 8. Build PR comment body
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const finding of scanJob.findings) {
      const severity = finding.severity.toLowerCase();
      if (severity in severityCounts) {
        severityCounts[severity as keyof typeof severityCounts]++;
      }
    }

    const scanResultSummary: ScanResultSummary = {
      scanId,
      overallScore: score,
      statusResult,
      findings: scanJob.findings.map((f) => ({
        title: f.title,
        severity: f.severity,
        category: f.category,
        standardReference: f.standardReference ?? undefined,
      })),
      criticalCount: severityCounts.critical,
      highCount: severityCounts.high,
      mediumCount: severityCounts.medium,
      lowCount: severityCounts.low,
      infoCount: severityCounts.info,
      reportUrl: targetUrl,
    };

    const commentBody = this.buildPrCommentBody(scanResultSummary);

    // 9. Post or update PR comment
    const commentId = await this.postOrUpdatePrComment({
      installationId: metadata.installationId,
      owner,
      repo,
      prNumber: metadata.prNumber,
      body: commentBody,
      existingCommentId: metadata.commentId ?? undefined,
    });

    // 10. Update PrScanMetadata with commentId and statusPosted
    await this.prisma.prScanMetadata.update({
      where: { scanJobId: scanId },
      data: {
        statusPosted: state,
        ...(commentId !== undefined && { commentId }),
      },
    });

    this.logger.log(
      `Scan completed for ${metadata.repoFullName}#${metadata.prNumber}: ` +
        `score=${score}, status=${state}`,
    );
  }

  /** Utility to delay execution for the specified milliseconds. */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
