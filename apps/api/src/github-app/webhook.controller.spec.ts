/**
 * Unit tests for WebhookController edge cases.
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 1.6
 *
 * Tests cover:
 * - Missing X-Hub-Signature-256 header → 401
 * - Unconfigured webhook secret (no GITHUB_APP_WEBHOOK_SECRET) → 503
 * - Invalid HMAC signature → 401
 * - Malformed JSON body (raw body that isn't valid JSON) → 400
 * - Unrecognized event type (e.g., 'push') → 200 with no service method called
 */

import { WebhookController } from './webhook.controller.js';
import { GitHubAppService } from './github-app.service.js';
import { WebhookRateLimiter } from './webhook-rate-limiter.service.js';
import { computeWebhookSignature } from './webhook-signature.js';
import * as githubAppConfig from './github-app.config.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('./github-app.config.js', () => ({
  loadGitHubAppConfig: jest.fn(),
}));

const mockLoadGitHubAppConfig = githubAppConfig.loadGitHubAppConfig as jest.Mock;

/** Create a mock GitHubAppService with all handler methods stubbed. */
function createMockGitHubAppService(): jest.Mocked<
  Pick<
    GitHubAppService,
    'handlePullRequestEvent' | 'handleInstallationEvent' | 'handleInstallationRepositoriesEvent'
  >
> {
  return {
    handlePullRequestEvent: jest.fn().mockResolvedValue(undefined),
    handleInstallationEvent: jest.fn().mockResolvedValue(undefined),
    handleInstallationRepositoriesEvent: jest.fn().mockResolvedValue(undefined),
  };
}

/** Create a mock WebhookRateLimiter. */
function createMockRateLimiter(): jest.Mocked<
  Pick<WebhookRateLimiter, 'checkAllowed' | 'isExempt'>
> {
  return {
    checkAllowed: jest.fn().mockResolvedValue({ allowed: true }),
    isExempt: jest.fn().mockReturnValue(false),
  };
}

/** Create a mock Express Request with rawBody and headers. */
function createMockRequest(options: {
  rawBody?: Buffer;
  headers?: Record<string, string | undefined>;
}): any {
  return {
    rawBody: options.rawBody,
    headers: options.headers ?? {},
  };
}

/** Create a mock Express Response with chainable methods. */
function createMockResponse(): any {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_SECRET = 'whsec_test_secret_12345';

/** A valid JSON payload for testing. */
const VALID_PAYLOAD = JSON.stringify({
  action: 'opened',
  number: 42,
  pull_request: { number: 42, head: { sha: 'abc123', ref: 'feature-branch' } },
  repository: {
    full_name: 'org/repo',
    clone_url: 'https://github.com/org/repo.git',
    owner: { login: 'org' },
    name: 'repo',
  },
  installation: { id: 12345 },
});

/** A config object representing a fully configured GitHub App. */
function configuredConfig(overrides: Partial<ReturnType<typeof githubAppConfig.loadGitHubAppConfig>> = {}) {
  return {
    enabled: true,
    appId: '12345',
    privateKey: 'fake-key',
    webhookSecret: TEST_SECRET,
    scanTimeout: 300,
    rateLimitPerInstallation: 60,
    globalConcurrentScans: 10,
    credentialsConfigured: true,
    ...overrides,
  };
}

/** A config object with no webhook secret. */
function unconfiguredSecretConfig() {
  return {
    enabled: true,
    appId: '12345',
    privateKey: 'fake-key',
    webhookSecret: undefined,
    scanTimeout: 300,
    rateLimitPerInstallation: 60,
    globalConcurrentScans: 10,
    credentialsConfigured: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebhookController', () => {
  let controller: WebhookController;
  let mockService: ReturnType<typeof createMockGitHubAppService>;
  let mockRateLimiter: ReturnType<typeof createMockRateLimiter>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockService = createMockGitHubAppService();
    mockRateLimiter = createMockRateLimiter();
    controller = new WebhookController(
      mockService as any,
      mockRateLimiter as any,
    );
  });

  describe('Missing X-Hub-Signature-256 header → 401', () => {
    it('returns 401 when X-Hub-Signature-256 header is absent', async () => {
      mockLoadGitHubAppConfig.mockReturnValue(configuredConfig());

      const rawBody = Buffer.from(VALID_PAYLOAD, 'utf8');
      const req = createMockRequest({
        rawBody,
        headers: {
          'x-github-event': 'pull_request',
          // No x-hub-signature-256
        },
      });
      const res = createMockResponse();

      await controller.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: expect.stringContaining('Missing'),
        }),
      );
    });

    it('does not call any service handler methods when signature is missing', async () => {
      mockLoadGitHubAppConfig.mockReturnValue(configuredConfig());

      const rawBody = Buffer.from(VALID_PAYLOAD, 'utf8');
      const req = createMockRequest({
        rawBody,
        headers: { 'x-github-event': 'pull_request' },
      });
      const res = createMockResponse();

      await controller.handleWebhook(req, res);

      expect(mockService.handlePullRequestEvent).not.toHaveBeenCalled();
      expect(mockService.handleInstallationEvent).not.toHaveBeenCalled();
      expect(mockService.handleInstallationRepositoriesEvent).not.toHaveBeenCalled();
    });
  });

  describe('Unconfigured webhook secret → 503', () => {
    it('returns 503 when GITHUB_APP_WEBHOOK_SECRET is not configured', async () => {
      mockLoadGitHubAppConfig.mockReturnValue(unconfiguredSecretConfig());

      const rawBody = Buffer.from(VALID_PAYLOAD, 'utf8');
      const signature = computeWebhookSignature(rawBody, 'any-secret');
      const req = createMockRequest({
        rawBody,
        headers: {
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
        },
      });
      const res = createMockResponse();

      await controller.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 503,
          message: expect.stringContaining('unavailable'),
        }),
      );
    });

    it('does not process any events when secret is unconfigured', async () => {
      mockLoadGitHubAppConfig.mockReturnValue(unconfiguredSecretConfig());

      const rawBody = Buffer.from(VALID_PAYLOAD, 'utf8');
      const req = createMockRequest({
        rawBody,
        headers: {
          'x-hub-signature-256': 'sha256=abc',
          'x-github-event': 'installation',
        },
      });
      const res = createMockResponse();

      await controller.handleWebhook(req, res);

      expect(mockService.handlePullRequestEvent).not.toHaveBeenCalled();
      expect(mockService.handleInstallationEvent).not.toHaveBeenCalled();
      expect(mockService.handleInstallationRepositoriesEvent).not.toHaveBeenCalled();
    });
  });

  describe('Invalid HMAC signature → 401', () => {
    it('returns 401 when signature does not match payload', async () => {
      mockLoadGitHubAppConfig.mockReturnValue(configuredConfig());

      const rawBody = Buffer.from(VALID_PAYLOAD, 'utf8');
      // Compute signature with a WRONG secret
      const badSignature = computeWebhookSignature(rawBody, 'wrong-secret');
      const req = createMockRequest({
        rawBody,
        headers: {
          'x-hub-signature-256': badSignature,
          'x-github-event': 'pull_request',
        },
      });
      const res = createMockResponse();

      await controller.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: expect.stringContaining('Invalid'),
        }),
      );
    });

    it('returns 401 when rawBody is missing', async () => {
      mockLoadGitHubAppConfig.mockReturnValue(configuredConfig());

      const req = createMockRequest({
        rawBody: undefined,
        headers: {
          'x-hub-signature-256': 'sha256=abc123',
          'x-github-event': 'pull_request',
        },
      });
      const res = createMockResponse();

      await controller.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 }),
      );
    });

    it('does not dispatch events when HMAC verification fails', async () => {
      mockLoadGitHubAppConfig.mockReturnValue(configuredConfig());

      const rawBody = Buffer.from(VALID_PAYLOAD, 'utf8');
      const badSignature = computeWebhookSignature(rawBody, 'not-the-real-secret');
      const req = createMockRequest({
        rawBody,
        headers: {
          'x-hub-signature-256': badSignature,
          'x-github-event': 'pull_request',
        },
      });
      const res = createMockResponse();

      await controller.handleWebhook(req, res);

      expect(mockService.handlePullRequestEvent).not.toHaveBeenCalled();
      expect(mockService.handleInstallationEvent).not.toHaveBeenCalled();
      expect(mockService.handleInstallationRepositoriesEvent).not.toHaveBeenCalled();
    });
  });

  describe('Malformed JSON body → 400', () => {
    it('returns 400 when raw body is not valid JSON', async () => {
      mockLoadGitHubAppConfig.mockReturnValue(configuredConfig());

      const malformedBody = Buffer.from('this is not { valid json', 'utf8');
      const signature = computeWebhookSignature(malformedBody, TEST_SECRET);
      const req = createMockRequest({
        rawBody: malformedBody,
        headers: {
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
        },
      });
      const res = createMockResponse();

      await controller.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: expect.stringContaining('Malformed'),
        }),
      );
    });

    it('returns 400 for truncated JSON', async () => {
      mockLoadGitHubAppConfig.mockReturnValue(configuredConfig());

      const truncatedJson = Buffer.from('{"action": "opened", "incomplete', 'utf8');
      const signature = computeWebhookSignature(truncatedJson, TEST_SECRET);
      const req = createMockRequest({
        rawBody: truncatedJson,
        headers: {
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
        },
      });
      const res = createMockResponse();

      await controller.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400 }),
      );
    });

    it('does not dispatch events for malformed body', async () => {
      mockLoadGitHubAppConfig.mockReturnValue(configuredConfig());

      const malformedBody = Buffer.from('<xml>not json</xml>', 'utf8');
      const signature = computeWebhookSignature(malformedBody, TEST_SECRET);
      const req = createMockRequest({
        rawBody: malformedBody,
        headers: {
          'x-hub-signature-256': signature,
          'x-github-event': 'installation',
        },
      });
      const res = createMockResponse();

      await controller.handleWebhook(req, res);

      expect(mockService.handlePullRequestEvent).not.toHaveBeenCalled();
      expect(mockService.handleInstallationEvent).not.toHaveBeenCalled();
      expect(mockService.handleInstallationRepositoriesEvent).not.toHaveBeenCalled();
    });
  });

  describe('Unrecognized event type → 200 with no processing', () => {
    it('returns 200 for an unrecognized event type like "push"', async () => {
      mockLoadGitHubAppConfig.mockReturnValue(configuredConfig());

      const payload = JSON.stringify({ ref: 'refs/heads/main', commits: [] });
      const rawBody = Buffer.from(payload, 'utf8');
      const signature = computeWebhookSignature(rawBody, TEST_SECRET);
      const req = createMockRequest({
        rawBody,
        headers: {
          'x-hub-signature-256': signature,
          'x-github-event': 'push',
        },
      });
      const res = createMockResponse();

      await controller.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it('does not call any service method for unrecognized events', async () => {
      mockLoadGitHubAppConfig.mockReturnValue(configuredConfig());

      const payload = JSON.stringify({ action: 'completed' });
      const rawBody = Buffer.from(payload, 'utf8');
      const signature = computeWebhookSignature(rawBody, TEST_SECRET);
      const req = createMockRequest({
        rawBody,
        headers: {
          'x-hub-signature-256': signature,
          'x-github-event': 'check_run',
        },
      });
      const res = createMockResponse();

      await controller.handleWebhook(req, res);

      // Give setImmediate time to execute the async dispatch
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockService.handlePullRequestEvent).not.toHaveBeenCalled();
      expect(mockService.handleInstallationEvent).not.toHaveBeenCalled();
      expect(mockService.handleInstallationRepositoriesEvent).not.toHaveBeenCalled();
    });

    it('returns 200 for an empty/missing event type', async () => {
      mockLoadGitHubAppConfig.mockReturnValue(configuredConfig());

      const payload = JSON.stringify({ data: 'test' });
      const rawBody = Buffer.from(payload, 'utf8');
      const signature = computeWebhookSignature(rawBody, TEST_SECRET);
      const req = createMockRequest({
        rawBody,
        headers: {
          'x-hub-signature-256': signature,
          // No x-github-event header
        },
      });
      const res = createMockResponse();

      await controller.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it('dispatches recognized events correctly when signature is valid', async () => {
      mockLoadGitHubAppConfig.mockReturnValue(configuredConfig());
      mockRateLimiter.isExempt.mockReturnValue(false);
      mockRateLimiter.checkAllowed.mockResolvedValue({ allowed: true });

      const rawBody = Buffer.from(VALID_PAYLOAD, 'utf8');
      const signature = computeWebhookSignature(rawBody, TEST_SECRET);
      const req = createMockRequest({
        rawBody,
        headers: {
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
        },
      });
      const res = createMockResponse();

      await controller.handleWebhook(req, res);

      // Should acknowledge with 200
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });

      // Give setImmediate time to execute the async dispatch
      await new Promise((resolve) => setImmediate(resolve));

      // Should dispatch to the pull_request handler
      expect(mockService.handlePullRequestEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'opened', number: 42 }),
      );
    });
  });
});
