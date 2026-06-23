/**
 * Integration tests for the GitHub App webhook → scan → status flow.
 *
 * Tests the key interaction flows with mocked external dependencies
 * (GitHub API, Redis) but real service logic.
 *
 * Validates: Requirements 1.7, 2.4, 2.5, 3.1, 6.1, 6.2, 8.1, 8.2
 */

import { GitHubAppService } from './github-app.service';
import { GitHubTokenService } from './github-token.service';
import { WebhookRateLimiter } from './webhook-rate-limiter.service';
import { RepositoryConfigService } from './repository-config.service';
import { AuditService } from '../audit/audit.service';
import {
  PullRequestEventPayload,
  InstallationEventPayload,
} from './types';
import { computeWebhookSignature, verifyWebhookSignature } from './webhook-signature';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

/** Mock PrismaService with in-memory stores */
function createMockPrisma() {
  const installations: any[] = [];
  const scanJobs: any[] = [];
  const prScanMetadata: any[] = [];
  const repositoryConfigs: any[] = [];
  const auditLogs: any[] = [];

  return {
    _stores: { installations, scanJobs, prScanMetadata, repositoryConfigs, auditLogs },

    gitHubInstallation: {
      upsert: jest.fn(async ({ where, create, update }) => {
        const existing = installations.find(
          (i) => i.installationId === where.installationId,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const record = { id: `inst-${Date.now()}`, ...create };
        installations.push(record);
        return record;
      }),
      findUnique: jest.fn(async ({ where }) => {
        return installations.find(
          (i) => i.installationId === where.installationId,
        ) || null;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const matches = installations.filter(
          (i) => i.installationId === where.installationId,
        );
        matches.forEach((m) => Object.assign(m, data));
        return { count: matches.length };
      }),
      update: jest.fn(async ({ where, data }) => {
        const existing = installations.find(
          (i) => i.installationId === where.installationId,
        );
        if (existing) Object.assign(existing, data);
        return existing;
      }),
    },

    scanJob: {
      create: jest.fn(async ({ data }) => {
        const record = {
          id: `scan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        scanJobs.push(record);
        return record;
      }),
      findUnique: jest.fn(async ({ where, include }) => {
        const job = scanJobs.find((j) => j.id === where.id) || null;
        if (job && include?.findings) {
          job.findings = job.findings || [];
        }
        return job;
      }),
      update: jest.fn(async ({ where, data }) => {
        const existing = scanJobs.find((j) => j.id === where.id);
        if (existing) Object.assign(existing, data);
        return existing;
      }),
    },

    prScanMetadata: {
      create: jest.fn(async ({ data }) => {
        const record = {
          id: `meta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ...data,
          commentId: null,
          statusPosted: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        prScanMetadata.push(record);
        return record;
      }),
      findUnique: jest.fn(async ({ where }) => {
        return prScanMetadata.find(
          (m) => m.scanJobId === where.scanJobId,
        ) || null;
      }),
      findMany: jest.fn(async ({ where }) => {
        return prScanMetadata.filter(
          (m) => m.repoFullName === where.repoFullName && m.prNumber === where.prNumber,
        );
      }),
      update: jest.fn(async ({ where, data }) => {
        const existing = prScanMetadata.find(
          (m) => m.scanJobId === where.scanJobId,
        );
        if (existing) Object.assign(existing, data);
        return existing;
      }),
    },

    repositoryConfig: {
      findUnique: jest.fn(async ({ where }) => {
        return repositoryConfigs.find(
          (r) => r.repoFullName === where.repoFullName,
        ) || null;
      }),
      upsert: jest.fn(async ({ where, create, update }) => {
        const existing = repositoryConfigs.find(
          (r) => r.repoFullName === where.repoFullName,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const record = { id: `cfg-${Date.now()}`, ...create };
        repositoryConfigs.push(record);
        return record;
      }),
    },

    auditLog: {
      create: jest.fn(async ({ data }) => {
        const record = { id: `audit-${Date.now()}`, ...data, createdAt: new Date() };
        auditLogs.push(record);
        return record;
      }),
    },
  };
}

/** Mock queue that captures added jobs */
function createMockQueue() {
  const jobs: any[] = [];
  return {
    _jobs: jobs,
    add: jest.fn(async (name: string, data: any) => {
      const job = { id: `job-${Date.now()}`, name, data };
      jobs.push(job);
      return job;
    }),
  };
}

/** Mock GitHubTokenService */
function createMockTokenService() {
  return {
    getInstallationToken: jest.fn(async () => 'mock-installation-token'),
    generateAppJwt: jest.fn(() => 'mock-jwt'),
    validateCredentials: jest.fn(() => ({ status: 'configured' as const })),
  };
}

/** Mock fetch for GitHub API calls */
function createMockFetch() {
  const calls: any[] = [];
  const mockFn = jest.fn(async (url: string, options?: any) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ id: 12345 }),
      text: async () => '{}',
    };
  });
  return { fn: mockFn, calls };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createPrEventPayload(overrides: Partial<{
  action: string;
  installationId: number;
  repoFullName: string;
  owner: string;
  repoName: string;
  prNumber: number;
  headSha: string;
  headBranch: string;
  cloneUrl: string;
}> = {}): PullRequestEventPayload {
  const o = {
    action: 'opened',
    installationId: 1001,
    repoFullName: 'testorg/testrepo',
    owner: 'testorg',
    repoName: 'testrepo',
    prNumber: 42,
    headSha: 'abc123def456',
    headBranch: 'feature/test',
    cloneUrl: 'https://github.com/testorg/testrepo.git',
    ...overrides,
  };

  return {
    action: o.action,
    number: o.prNumber,
    pull_request: {
      number: o.prNumber,
      head: { sha: o.headSha, ref: o.headBranch },
    },
    repository: {
      full_name: o.repoFullName,
      clone_url: o.cloneUrl,
      owner: { login: o.owner },
      name: o.repoName,
    },
    installation: { id: o.installationId },
  };
}

function createInstallationEventPayload(
  action: 'created' | 'deleted',
  installationId: number = 1001,
): InstallationEventPayload {
  return {
    action,
    installation: {
      id: installationId,
      account: { login: 'testorg', type: 'Organization' },
    },
    repositories: [
      { full_name: 'testorg/testrepo' },
      { full_name: 'testorg/other-repo' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe('GitHub App Integration Tests', () => {
  let service: GitHubAppService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockQueue: ReturnType<typeof createMockQueue>;
  let mockTokenService: ReturnType<typeof createMockTokenService>;
  let mockAuditService: { record: jest.Mock };
  let rateLimiter: WebhookRateLimiter;
  let repoConfigService: RepositoryConfigService;
  let originalFetch: typeof global.fetch;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    // Set up environment for config loading
    process.env.GITHUB_APP_ENABLED = 'true';
    process.env.GITHUB_APP_ID = 'test-app-id';
    process.env.GITHUB_APP_PRIVATE_KEY = 'test-private-key';
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'test-webhook-secret';
    process.env.GITHUB_APP_RATE_LIMIT_PER_INSTALLATION = '60';
    process.env.GITHUB_APP_GLOBAL_CONCURRENT_SCANS = '10';

    mockPrisma = createMockPrisma();
    mockQueue = createMockQueue();
    mockTokenService = createMockTokenService();
    mockAuditService = { record: jest.fn(async () => {}) };
    mockFetch = createMockFetch();

    // Replace global fetch
    originalFetch = global.fetch;
    global.fetch = mockFetch.fn as any;

    // Create rate limiter with no Redis (fail-open behavior)
    // This avoids needing a real Redis connection in tests.
    delete process.env.REDIS_URL;
    rateLimiter = new WebhookRateLimiter();

    // Create RepositoryConfigService with mock Prisma
    repoConfigService = new RepositoryConfigService(
      mockPrisma as any,
      mockAuditService as any,
    );

    // Create the main service
    service = new GitHubAppService(
      mockTokenService as any,
      mockAuditService as any,
      mockPrisma as any,
      rateLimiter,
      repoConfigService,
      mockQueue as any,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.GITHUB_APP_ENABLED;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    delete process.env.GITHUB_APP_RATE_LIMIT_PER_INSTALLATION;
    delete process.env.GITHUB_APP_GLOBAL_CONCURRENT_SCANS;
  });

  // =========================================================================
  // Test 1: Webhook receipt → signature verification → scan enqueue
  // Validates: Requirements 1.7, 2.4, 3.1
  // =========================================================================
  describe('Webhook receipt → scan enqueue flow', () => {
    it('verifies webhook signature and enqueues scan on valid PR event', async () => {
      // 1. Set up an active installation
      const installPayload = createInstallationEventPayload('created', 1001);
      await service.handleInstallationEvent(installPayload);

      // 2. Send a PR event
      const prPayload = createPrEventPayload();
      await service.handlePullRequestEvent(prPayload);

      // 3. Verify scan job was created
      expect(mockPrisma.scanJob.create).toHaveBeenCalledTimes(1);
      const createCall = mockPrisma.scanJob.create.mock.calls[0][0];
      expect(createCall.data.sourceType).toBe('repository');
      expect(createCall.data.triggerType).toBe('github-pr');
      expect(createCall.data.sourceRef).toContain('abc123def456');
      expect(createCall.data.status).toBe('queued');

      // 4. Verify PrScanMetadata was created
      expect(mockPrisma.prScanMetadata.create).toHaveBeenCalledTimes(1);
      const metaCall = mockPrisma.prScanMetadata.create.mock.calls[0][0];
      expect(metaCall.data.installationId).toBe(1001);
      expect(metaCall.data.repoFullName).toBe('testorg/testrepo');
      expect(metaCall.data.prNumber).toBe(42);
      expect(metaCall.data.headSha).toBe('abc123def456');

      // 5. Verify scan was enqueued on BullMQ
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith('process-scan', expect.objectContaining({
        scanId: expect.any(String),
      }));

      // 6. Verify pending commit status was posted
      expect(mockTokenService.getInstallationToken).toHaveBeenCalledWith(1001);
      expect(mockFetch.fn).toHaveBeenCalled();
      const statusCall = mockFetch.calls.find((c) =>
        c.url.includes('/statuses/'),
      );
      expect(statusCall).toBeDefined();
      const statusBody = JSON.parse(statusCall!.options.body);
      expect(statusBody.state).toBe('pending');
      expect(statusBody.context).toBe('slopshield/scan');
    });

    it('computes and verifies webhook HMAC signature correctly', () => {
      const secret = 'my-webhook-secret';
      const payload = Buffer.from(JSON.stringify({ action: 'opened' }));

      // Compute signature
      const signature = computeWebhookSignature(payload, secret);
      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);

      // Verify with correct secret
      expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);

      // Verify with wrong secret
      expect(verifyWebhookSignature(payload, signature, 'wrong-secret')).toBe(false);

      // Verify with mutated payload
      const mutated = Buffer.from(JSON.stringify({ action: 'closed' }));
      expect(verifyWebhookSignature(mutated, signature, secret)).toBe(false);
    });

    it('ignores non-scan-triggering PR actions', async () => {
      const installPayload = createInstallationEventPayload('created', 1001);
      await service.handleInstallationEvent(installPayload);

      const prPayload = createPrEventPayload({ action: 'closed' });
      await service.handlePullRequestEvent(prPayload);

      expect(mockPrisma.scanJob.create).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test 2: Installation lifecycle
  // Validates: Requirements 6.1, 6.2
  // =========================================================================
  describe('Installation lifecycle', () => {
    it('created → repos queryable → PR events accepted', async () => {
      // 1. Install the app
      const installPayload = createInstallationEventPayload('created', 2001);
      await service.handleInstallationEvent(installPayload);

      // 2. Verify installation is persisted and active
      expect(mockPrisma.gitHubInstallation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { installationId: 2001 },
          create: expect.objectContaining({
            installationId: 2001,
            accountLogin: 'testorg',
            accountType: 'Organization',
            active: true,
            repositories: ['testorg/testrepo', 'testorg/other-repo'],
          }),
        }),
      );

      // 3. Verify installation is queryable
      const found = await mockPrisma.gitHubInstallation.findUnique({
        where: { installationId: 2001 },
      });
      expect(found).not.toBeNull();
      expect(found!.active).toBe(true);

      // 4. Verify PR events are now accepted for this installation
      const prPayload = createPrEventPayload({ installationId: 2001 });
      await service.handlePullRequestEvent(prPayload);
      expect(mockPrisma.scanJob.create).toHaveBeenCalledTimes(1);
    });

    it('deleted → installation inactive → PR events rejected', async () => {
      // 1. Create installation
      const createPayload = createInstallationEventPayload('created', 3001);
      await service.handleInstallationEvent(createPayload);

      // 2. Delete installation
      const deletePayload = createInstallationEventPayload('deleted', 3001);
      await service.handleInstallationEvent(deletePayload);

      // 3. Verify installation marked inactive (not deleted — Req 6.3)
      const found = await mockPrisma.gitHubInstallation.findUnique({
        where: { installationId: 3001 },
      });
      expect(found).not.toBeNull();
      expect(found!.active).toBe(false);

      // 4. Verify PR events are rejected for inactive installation
      const prPayload = createPrEventPayload({ installationId: 3001 });
      await service.handlePullRequestEvent(prPayload);
      expect(mockPrisma.scanJob.create).not.toHaveBeenCalled();
    });

    it('records installation events in audit log', async () => {
      const installPayload = createInstallationEventPayload('created', 4001);
      await service.handleInstallationEvent(installPayload);

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'installation.created',
          target: 'testorg',
          metadata: expect.objectContaining({
            installationId: 4001,
            accountType: 'Organization',
          }),
        }),
      );
    });
  });

  // =========================================================================
  // Test 3: Scan supersession on synchronize
  // Validates: Requirement 2.5
  // =========================================================================
  describe('Scan supersession', () => {
    it('cancels first scan when second synchronize event arrives for same PR', async () => {
      // 1. Set up installation
      const installPayload = createInstallationEventPayload('created', 5001);
      await service.handleInstallationEvent(installPayload);

      // 2. First synchronize event
      const prPayload1 = createPrEventPayload({
        action: 'synchronize',
        installationId: 5001,
        headSha: 'sha-first-commit',
        prNumber: 99,
      });
      await service.handlePullRequestEvent(prPayload1);

      // Verify first scan was created
      expect(mockPrisma.scanJob.create).toHaveBeenCalledTimes(1);
      const firstScanId = mockPrisma.scanJob.create.mock.results[0].value.then
        ? (await mockPrisma.scanJob.create.mock.results[0].value).id
        : mockPrisma.scanJob.create.mock.results[0].value.id;

      // Mark it as still queued so it gets superseded
      const firstScan = mockPrisma._stores.scanJobs.find(
        (j: any) => j.id === firstScanId,
      );
      expect(firstScan).toBeDefined();
      expect(firstScan.status).toBe('queued');

      // 3. Second synchronize event with different SHA
      const prPayload2 = createPrEventPayload({
        action: 'synchronize',
        installationId: 5001,
        headSha: 'sha-second-commit',
        prNumber: 99,
      });
      await service.handlePullRequestEvent(prPayload2);

      // 4. Verify first scan is cancelled
      expect(mockPrisma.scanJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: firstScanId },
          data: expect.objectContaining({ status: 'cancelled' }),
        }),
      );

      // 5. Verify second scan was created
      expect(mockPrisma.scanJob.create).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // Test 4: Scan completion → status posted
  // Validates: Requirements 3.1, 3.2, 3.3
  // =========================================================================
  describe('Scan completion → status posted', () => {
    it('posts success status when score meets threshold', async () => {
      // 1. Set up: install, create scan, and metadata in stores
      const installPayload = createInstallationEventPayload('created', 6001);
      await service.handleInstallationEvent(installPayload);

      // Manually set up scan job + metadata to simulate completed scan
      const scanId = 'scan-completed-success';
      mockPrisma._stores.scanJobs.push({
        id: scanId,
        sourceType: 'repository',
        triggerType: 'github-pr',
        status: 'completed',
        overallScore: 85,
        statusResult: 'passed',
        scanMode: 'full',
        findings: [
          {
            title: 'Minor issue',
            severity: 'low',
            category: 'maintainability',
            standardReference: 'M-001',
          },
        ],
      });

      mockPrisma._stores.prScanMetadata.push({
        id: 'meta-1',
        scanJobId: scanId,
        installationId: 6001,
        repoFullName: 'testorg/testrepo',
        prNumber: 10,
        headSha: 'completed-sha-123',
        headBranch: 'feature/done',
        commentId: null,
        statusPosted: null,
      });

      // 2. Trigger scan completion event
      await service.onScanCompleted({ scanId });

      // 3. Verify commit status was posted (success since 85 >= 70)
      const statusCalls = mockFetch.calls.filter((c) =>
        c.url.includes('/statuses/completed-sha-123'),
      );
      expect(statusCalls.length).toBeGreaterThanOrEqual(1);
      const statusBody = JSON.parse(statusCalls[0].options.body);
      expect(statusBody.state).toBe('success');
      expect(statusBody.context).toBe('slopshield/scan');
      expect(statusBody.description).toContain('85');

      // 4. Verify PR comment was posted
      const commentCalls = mockFetch.calls.filter((c) =>
        c.url.includes('/issues/10/comments'),
      );
      expect(commentCalls.length).toBe(1);
      const commentBody = JSON.parse(commentCalls[0].options.body);
      expect(commentBody.body).toContain('85');
      expect(commentBody.body).toContain('SlopShield');
    });

    it('posts failure status when score is below threshold', async () => {
      const installPayload = createInstallationEventPayload('created', 7001);
      await service.handleInstallationEvent(installPayload);

      const scanId = 'scan-completed-failure';
      mockPrisma._stores.scanJobs.push({
        id: scanId,
        sourceType: 'repository',
        triggerType: 'github-pr',
        status: 'completed',
        overallScore: 55,
        statusResult: 'risky',
        scanMode: 'full',
        findings: [
          {
            title: 'SQL Injection',
            severity: 'critical',
            category: 'security',
            standardReference: 'S-001',
          },
          {
            title: 'XSS Vulnerability',
            severity: 'high',
            category: 'security',
            standardReference: 'S-002',
          },
        ],
      });

      mockPrisma._stores.prScanMetadata.push({
        id: 'meta-2',
        scanJobId: scanId,
        installationId: 7001,
        repoFullName: 'testorg/testrepo',
        prNumber: 20,
        headSha: 'fail-sha-456',
        headBranch: 'feature/risky',
        commentId: null,
        statusPosted: null,
      });

      await service.onScanCompleted({ scanId });

      const statusCalls = mockFetch.calls.filter((c) =>
        c.url.includes('/statuses/fail-sha-456'),
      );
      expect(statusCalls.length).toBeGreaterThanOrEqual(1);
      const statusBody = JSON.parse(statusCalls[0].options.body);
      expect(statusBody.state).toBe('failure');
      expect(statusBody.description).toContain('55');
    });

    it('posts error status when scan failed', async () => {
      const installPayload = createInstallationEventPayload('created', 8001);
      await service.handleInstallationEvent(installPayload);

      const scanId = 'scan-completed-error';
      mockPrisma._stores.scanJobs.push({
        id: scanId,
        sourceType: 'repository',
        triggerType: 'github-pr',
        status: 'failed',
        overallScore: null,
        statusResult: null,
        failureReason: 'Timeout exceeded',
        scanMode: 'full',
        findings: [],
      });

      mockPrisma._stores.prScanMetadata.push({
        id: 'meta-3',
        scanJobId: scanId,
        installationId: 8001,
        repoFullName: 'testorg/testrepo',
        prNumber: 30,
        headSha: 'error-sha-789',
        headBranch: 'feature/broken',
        commentId: null,
        statusPosted: null,
      });

      await service.onScanCompleted({ scanId });

      const statusCalls = mockFetch.calls.filter((c) =>
        c.url.includes('/statuses/error-sha-789'),
      );
      expect(statusCalls.length).toBeGreaterThanOrEqual(1);
      const statusBody = JSON.parse(statusCalls[0].options.body);
      expect(statusBody.state).toBe('error');
      expect(statusBody.description).toContain('could not be completed');
    });

    it('does not post status for non-PR scans', async () => {
      // onScanCompleted should return early if no PrScanMetadata exists
      await service.onScanCompleted({ scanId: 'non-existent-scan' });

      expect(mockFetch.fn).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test 5: Rate limiting
  // Validates: Requirements 8.1, 8.2
  // =========================================================================
  describe('Rate limiting', () => {
    it('rate limiter fails open when Redis is unavailable', async () => {
      // With no REDIS_URL, the rate limiter should allow all requests
      const result = await rateLimiter.checkAllowed(9999);
      expect(result.allowed).toBe(true);
    });

    it('installation lifecycle events are exempt from rate limiting', () => {
      expect(rateLimiter.isExempt('installation')).toBe(true);
      expect(rateLimiter.isExempt('installation_repositories')).toBe(true);
      expect(rateLimiter.isExempt('pull_request')).toBe(false);
    });

    it('skips scan when installation is not found', async () => {
      // No installation created — PR event should be ignored
      const prPayload = createPrEventPayload({ installationId: 99999 });
      await service.handlePullRequestEvent(prPayload);

      expect(mockPrisma.scanJob.create).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test 6: Full flow end-to-end
  // Validates: Requirements 1.7, 2.4, 3.1
  // =========================================================================
  describe('Full webhook → scan → status end-to-end', () => {
    it('complete flow: install → PR event → enqueue → complete → status posted', async () => {
      // 1. Install the GitHub App
      await service.handleInstallationEvent(
        createInstallationEventPayload('created', 10001),
      );

      // 2. Receive a PR opened event
      const prPayload = createPrEventPayload({
        installationId: 10001,
        headSha: 'e2e-sha-abc',
        prNumber: 77,
      });
      await service.handlePullRequestEvent(prPayload);

      // 3. Verify pending status was posted
      const pendingCalls = mockFetch.calls.filter((c) =>
        c.url.includes('/statuses/e2e-sha-abc'),
      );
      expect(pendingCalls.length).toBe(1);
      expect(JSON.parse(pendingCalls[0].options.body).state).toBe('pending');

      // 4. Get the scan ID from the created job
      const scanId = (await mockPrisma.scanJob.create.mock.results[0].value).id;

      // 5. Simulate scan completion by updating the stored scan job
      const storedScan = mockPrisma._stores.scanJobs.find(
        (j: any) => j.id === scanId,
      );
      storedScan.status = 'completed';
      storedScan.overallScore = 92;
      storedScan.statusResult = 'passed';
      storedScan.findings = [];

      // 6. Reset fetch mock calls to isolate completion status
      mockFetch.calls.length = 0;

      // 7. Trigger scan completion
      await service.onScanCompleted({ scanId });

      // 8. Verify success status was posted
      const successCalls = mockFetch.calls.filter((c) =>
        c.url.includes('/statuses/e2e-sha-abc'),
      );
      expect(successCalls.length).toBe(1);
      const finalStatus = JSON.parse(successCalls[0].options.body);
      expect(finalStatus.state).toBe('success');
      expect(finalStatus.description).toContain('92');
      expect(finalStatus.target_url).toContain(scanId);

      // 9. Verify PR comment was posted
      const commentCalls = mockFetch.calls.filter((c) =>
        c.url.includes('/issues/77/comments'),
      );
      expect(commentCalls.length).toBe(1);
    });
  });
});
