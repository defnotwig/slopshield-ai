import { GitHubAppService } from './github-app.service.js';
import { GitHubTokenService } from './github-token.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhookRateLimiter } from './webhook-rate-limiter.service.js';
import { RepositoryConfigService } from './repository-config.service.js';
import { PullRequestEventPayload } from './types.js';

/**
 * Unit tests for GitHubAppService.
 *
 * Covers:
 * 1. Installation token failure → error status (Requirement 9.4)
 * 2. PR comment failure → scan continues (Requirement 4.6)
 * 3. Inactive installation → no scan created (Requirement 6.6)
 */
describe('GitHubAppService', () => {
  let service: GitHubAppService;
  let tokenService: jest.Mocked<GitHubTokenService>;
  let auditService: jest.Mocked<AuditService>;
  let prisma: any;
  let rateLimiter: jest.Mocked<WebhookRateLimiter>;
  let repoConfigService: jest.Mocked<RepositoryConfigService>;
  let scanQueue: any;

  beforeEach(() => {
    tokenService = {
      getInstallationToken: jest.fn(),
      generateAppJwt: jest.fn(),
      validateCredentials: jest.fn(),
    } as any;

    auditService = {
      record: jest.fn().mockResolvedValue(undefined),
    } as any;

    prisma = {
      gitHubInstallation: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
      prScanMetadata: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      scanJob: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      repositoryConfig: {
        findUnique: jest.fn(),
      },
    };

    rateLimiter = {
      checkAllowed: jest.fn(),
      recordScanStart: jest.fn(),
      recordScanEnd: jest.fn(),
      isExempt: jest.fn(),
    } as any;

    repoConfigService = {
      getConfig: jest.fn(),
      upsertConfig: jest.fn(),
      validateThreshold: jest.fn(),
      validateScanMode: jest.fn(),
    } as any;

    scanQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };

    service = new GitHubAppService(
      tokenService,
      auditService,
      prisma as unknown as PrismaService,
      rateLimiter,
      repoConfigService,
      scanQueue,
    );
  });

  describe('Installation token failure → error status (Requirement 9.4)', () => {
    it('returns failure result with failureReason "token-generation-failed" when getInstallationToken throws', async () => {
      tokenService.getInstallationToken.mockRejectedValue(
        new Error('Private key invalid'),
      );

      const result = await service.postCommitStatus({
        installationId: 12345,
        owner: 'test-org',
        repo: 'test-repo',
        sha: 'abc123def456',
        state: 'success',
        description: 'Score: 85/100 — Passed',
        targetUrl: 'http://localhost:3000/scans/scan-1/report',
        context: 'slopshield/scan',
      });

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('token-generation-failed');
      expect(result.errorMessage).toContain('Private key invalid');
    });

    it('records audit log entry on token generation failure', async () => {
      tokenService.getInstallationToken.mockRejectedValue(
        new Error('Could not exchange JWT'),
      );

      await service.postCommitStatus({
        installationId: 99,
        owner: 'org',
        repo: 'repo',
        sha: 'deadbeef',
        state: 'pending',
        description: 'Scan in progress',
        targetUrl: 'http://localhost:3000/scans/scan-2/report',
        context: 'slopshield/scan',
      });

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'commit-status.token-generation-failed',
          target: 'org/repo@deadbeef',
          metadata: expect.objectContaining({
            installationId: 99,
            authError: true,
          }),
        }),
      );
    });

    it('does not call the GitHub API when token generation fails', async () => {
      tokenService.getInstallationToken.mockRejectedValue(
        new Error('Auth failure'),
      );

      // Mock global fetch to track calls
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({}), { status: 201 }),
      );

      await service.postCommitStatus({
        installationId: 1,
        owner: 'owner',
        repo: 'repo',
        sha: 'sha123',
        state: 'success',
        description: 'test',
        targetUrl: 'http://localhost:3000/scans/id/report',
        context: 'slopshield/scan',
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe('PR comment failure → scan continues (Requirement 4.6)', () => {
    it('onScanCompleted still updates metadata when postOrUpdatePrComment returns undefined', async () => {
      // Setup: a completed PR scan where comment posting will fail
      const scanId = 'scan-complete-1';

      prisma.prScanMetadata.findUnique.mockResolvedValue({
        scanJobId: scanId,
        installationId: 42,
        repoFullName: 'org/repo',
        prNumber: 7,
        headSha: 'abc123',
        headBranch: 'feature-x',
        commentId: null,
      });

      prisma.scanJob.findUnique.mockResolvedValue({
        id: scanId,
        status: 'completed',
        overallScore: 85,
        statusResult: 'passed',
        failureReason: null,
        findings: [],
      });

      repoConfigService.getConfig.mockResolvedValue({
        id: 'config-1',
        repoFullName: 'org/repo',
        installationId: null,
        scanThreshold: 70,
        scanMode: 'full',
        autoBlockEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // postCommitStatus succeeds
      tokenService.getInstallationToken.mockResolvedValue('fake-token');
      const fetchSpy = jest.spyOn(global, 'fetch');

      // First call: postCommitStatus succeeds (201 response)
      // Second call: postOrUpdatePrComment fails (500 response)
      fetchSpy
        .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 201 }))
        .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));

      prisma.prScanMetadata.update.mockResolvedValue({});

      await service.onScanCompleted({ scanId });

      // Verify metadata was still updated (scan continues despite comment failure)
      expect(prisma.prScanMetadata.update).toHaveBeenCalledWith({
        where: { scanJobId: scanId },
        data: expect.objectContaining({
          statusPosted: 'success',
        }),
      });

      fetchSpy.mockRestore();
    });

    it('postOrUpdatePrComment returns undefined on GitHub API error without throwing', async () => {
      tokenService.getInstallationToken.mockResolvedValue('token-123');

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{"message":"Not Found"}', { status: 404 }),
      );

      const result = await service.postOrUpdatePrComment({
        installationId: 10,
        owner: 'org',
        repo: 'repo',
        prNumber: 5,
        body: '## Scan Results\nScore: 90',
      });

      expect(result).toBeUndefined();
      fetchSpy.mockRestore();
    });

    it('postOrUpdatePrComment returns undefined when token retrieval fails', async () => {
      tokenService.getInstallationToken.mockRejectedValue(
        new Error('Token expired'),
      );

      const result = await service.postOrUpdatePrComment({
        installationId: 10,
        owner: 'org',
        repo: 'repo',
        prNumber: 3,
        body: '## Results',
      });

      expect(result).toBeUndefined();
    });
  });

  describe('Inactive installation → no scan created (Requirement 6.6)', () => {
    const makePrPayload = (installationId: number): PullRequestEventPayload => ({
      action: 'opened',
      number: 1,
      pull_request: {
        number: 1,
        head: { sha: 'abc123', ref: 'feature-branch' },
      },
      repository: {
        full_name: 'org/repo',
        clone_url: 'https://github.com/org/repo.git',
        owner: { login: 'org' },
        name: 'repo',
      },
      installation: { id: installationId },
    });

    it('does not create a ScanJob when installation is inactive', async () => {
      prisma.gitHubInstallation.findUnique.mockResolvedValue({
        installationId: 100,
        accountLogin: 'org',
        accountType: 'Organization',
        active: false,
        repositories: ['org/repo'],
      });

      await service.handlePullRequestEvent(makePrPayload(100));

      expect(prisma.scanJob.create).not.toHaveBeenCalled();
      expect(scanQueue.add).not.toHaveBeenCalled();
    });

    it('does not create a ScanJob when installation is not found', async () => {
      prisma.gitHubInstallation.findUnique.mockResolvedValue(null);

      await service.handlePullRequestEvent(makePrPayload(999));

      expect(prisma.scanJob.create).not.toHaveBeenCalled();
      expect(scanQueue.add).not.toHaveBeenCalled();
    });

    it('does not post any commit status when installation is inactive', async () => {
      prisma.gitHubInstallation.findUnique.mockResolvedValue({
        installationId: 200,
        accountLogin: 'user',
        accountType: 'User',
        active: false,
        repositories: ['user/repo'],
      });

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 201 }),
      );

      await service.handlePullRequestEvent(makePrPayload(200));

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });
});
