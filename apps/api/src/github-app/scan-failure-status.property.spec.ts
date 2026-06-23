import * as fc from 'fast-check';
import { GitHubAppService } from './github-app.service.js';
import { GitHubTokenService } from './github-token.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhookRateLimiter } from './webhook-rate-limiter.service.js';
import { RepositoryConfigService } from './repository-config.service.js';

/**
 * Property-based tests for scan failure producing neutral/error status.
 *
 * **Validates: Requirements 7.1, 7.3**
 *
 * Property 10: Scan failure produces neutral/error status
 * - For any PR-triggered scan that terminates with status `failed` (for any failure reason string),
 *   the system posts a commit status with state 'error' (not 'failure') and a description that
 *   contains the word "error" or "could not", distinguishing it from a deliberate code quality
 *   failure verdict.
 */
describe('Feature: github-pr-status-checks, Property 10: Scan failure produces neutral/error status', () => {
  let service: GitHubAppService;
  let mockPrisma: any;
  let mockTokenService: any;
  let mockAuditService: any;
  let mockRateLimiter: any;
  let mockRepoConfigService: any;
  let mockQueue: any;
  let postCommitStatusSpy: jest.SpyInstance;

  beforeEach(() => {
    mockTokenService = {
      getInstallationToken: jest.fn().mockResolvedValue('mock-token'),
      generateAppJwt: jest.fn(),
      validateCredentials: jest.fn(),
    } as unknown as GitHubTokenService;

    mockAuditService = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    mockPrisma = {
      prScanMetadata: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
      scanJob: {
        findUnique: jest.fn(),
      },
    } as unknown as PrismaService;

    mockRateLimiter = {} as unknown as WebhookRateLimiter;

    mockRepoConfigService = {
      getConfig: jest.fn().mockResolvedValue({
        scanThreshold: 70,
        scanMode: 'full',
        autoBlockEnabled: true,
      }),
    } as unknown as RepositoryConfigService;

    mockQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };

    service = new GitHubAppService(
      mockTokenService,
      mockAuditService,
      mockPrisma,
      mockRateLimiter,
      mockRepoConfigService,
      mockQueue,
    );

    // Spy on postCommitStatus to capture what state and description are posted
    postCommitStatusSpy = jest.spyOn(service, 'postCommitStatus').mockResolvedValue({
      success: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts state "error" (not "failure") for any failed scan with any failure reason', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random scan IDs
        fc.uuid(),
        // Generate random failure reason strings (non-empty)
        fc.string({ minLength: 1, maxLength: 200 }),
        // Generate random repo full names (owner/repo format)
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        ),
        // Generate random PR numbers
        fc.integer({ min: 1, max: 99999 }),
        // Generate random head SHA (40 hex chars)
        fc.hexaString({ minLength: 40, maxLength: 40 }),
        // Generate random installation IDs
        fc.integer({ min: 1, max: 999999 }),
        async (scanId, failureReason, [owner, repo], prNumber, headSha, installationId) => {
          const repoFullName = `${owner}/${repo}`;

          // Setup mocks for this iteration
          mockPrisma.prScanMetadata.findUnique.mockResolvedValue({
            scanJobId: scanId,
            installationId,
            repoFullName,
            prNumber,
            headSha,
            headBranch: 'feature-branch',
            commentId: null,
            statusPosted: null,
          });

          mockPrisma.scanJob.findUnique.mockResolvedValue({
            id: scanId,
            status: 'failed',
            failureReason,
            overallScore: null,
            statusResult: null,
            findings: [],
          });

          // Reset the spy call tracking for this iteration
          postCommitStatusSpy.mockClear();

          // Call onScanCompleted
          await service.onScanCompleted({ scanId });

          // PROPERTY ASSERTION: postCommitStatus must be called with state 'error'
          expect(postCommitStatusSpy).toHaveBeenCalledTimes(1);
          const callArgs = postCommitStatusSpy.mock.calls[0][0];

          // State MUST be 'error', not 'failure'
          expect(callArgs.state).toBe('error');
          expect(callArgs.state).not.toBe('failure');

          // Description MUST contain 'could not' or 'error' to distinguish from quality failure
          const description: string = callArgs.description;
          const containsDistinguisher =
            description.toLowerCase().includes('could not') ||
            description.toLowerCase().includes('error');
          expect(containsDistinguisher).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('posts state "error" with description containing "could not" even when failureReason is null/undefined', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        ),
        fc.integer({ min: 1, max: 99999 }),
        fc.hexaString({ minLength: 40, maxLength: 40 }),
        fc.integer({ min: 1, max: 999999 }),
        async (scanId, [owner, repo], prNumber, headSha, installationId) => {
          const repoFullName = `${owner}/${repo}`;

          mockPrisma.prScanMetadata.findUnique.mockResolvedValue({
            scanJobId: scanId,
            installationId,
            repoFullName,
            prNumber,
            headSha,
            headBranch: 'main',
            commentId: null,
            statusPosted: null,
          });

          // failureReason is null — still should post 'error' state
          mockPrisma.scanJob.findUnique.mockResolvedValue({
            id: scanId,
            status: 'failed',
            failureReason: null,
            overallScore: null,
            statusResult: null,
            findings: [],
          });

          postCommitStatusSpy.mockClear();

          await service.onScanCompleted({ scanId });

          expect(postCommitStatusSpy).toHaveBeenCalledTimes(1);
          const callArgs = postCommitStatusSpy.mock.calls[0][0];

          // State must be 'error'
          expect(callArgs.state).toBe('error');
          expect(callArgs.state).not.toBe('failure');

          // Description must contain 'could not' or 'error'
          const description: string = callArgs.description;
          const containsDistinguisher =
            description.toLowerCase().includes('could not') ||
            description.toLowerCase().includes('error');
          expect(containsDistinguisher).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('includes the failure reason in the description when provided', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        // Generate non-empty failure reason strings
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        ),
        fc.integer({ min: 1, max: 99999 }),
        fc.hexaString({ minLength: 40, maxLength: 40 }),
        fc.integer({ min: 1, max: 999999 }),
        async (scanId, failureReason, [owner, repo], prNumber, headSha, installationId) => {
          const repoFullName = `${owner}/${repo}`;

          mockPrisma.prScanMetadata.findUnique.mockResolvedValue({
            scanJobId: scanId,
            installationId,
            repoFullName,
            prNumber,
            headSha,
            headBranch: 'feature',
            commentId: null,
            statusPosted: null,
          });

          mockPrisma.scanJob.findUnique.mockResolvedValue({
            id: scanId,
            status: 'failed',
            failureReason,
            overallScore: null,
            statusResult: null,
            findings: [],
          });

          postCommitStatusSpy.mockClear();

          await service.onScanCompleted({ scanId });

          expect(postCommitStatusSpy).toHaveBeenCalledTimes(1);
          const callArgs = postCommitStatusSpy.mock.calls[0][0];

          // The description should contain the failure reason
          const description: string = callArgs.description;
          expect(description).toContain(failureReason);
        },
      ),
      { numRuns: 100 },
    );
  });
});
