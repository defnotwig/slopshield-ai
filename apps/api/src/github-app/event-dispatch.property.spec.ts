import * as fc from 'fast-check';
import { WebhookController } from './webhook.controller';
import { GitHubAppService } from './github-app.service';
import { WebhookRateLimiter } from './webhook-rate-limiter.service';

/**
 * Property-based tests for event dispatch routing correctness.
 *
 * **Validates: Requirements 1.5, 1.6, 2.6**
 *
 * Property 2: Event dispatch routing correctness
 * - For any webhook event type string in {'pull_request', 'installation',
 *   'installation_repositories'}, the controller dispatches to the corresponding handler.
 * - For any string NOT in the recognized set (including empty), the controller
 *   acknowledges with no side effects (no service method called).
 */
describe('Feature: github-pr-status-checks, Property 2: Event dispatch routing correctness', () => {
  const RECOGNIZED_EVENTS = ['pull_request', 'installation', 'installation_repositories'];

  function createMocks() {
    const githubAppService = {
      handlePullRequestEvent: jest.fn().mockResolvedValue(undefined),
      handleInstallationEvent: jest.fn().mockResolvedValue(undefined),
      handleInstallationRepositoriesEvent: jest.fn().mockResolvedValue(undefined),
    };

    const rateLimiter = {
      isExempt: jest.fn().mockReturnValue(false),
      checkAllowed: jest.fn().mockResolvedValue({ allowed: true }),
      recordScanStart: jest.fn().mockResolvedValue(undefined),
      recordScanEnd: jest.fn().mockResolvedValue(undefined),
    };

    // Instantiate the real controller with mocked dependencies
    const controller = new WebhookController(
      githubAppService as unknown as GitHubAppService,
      rateLimiter as unknown as WebhookRateLimiter,
    );

    return { controller, githubAppService, rateLimiter };
  }

  describe('Recognized event types dispatch to the correct handler', () => {
    it('pull_request events dispatch to handlePullRequestEvent', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.json(),
          async (bodyStr) => {
            const { controller, githubAppService } = createMocks();
            const body = JSON.parse(bodyStr);

            await (controller as any).dispatchEvent('pull_request', body);

            expect(githubAppService.handlePullRequestEvent).toHaveBeenCalledTimes(1);
            expect(githubAppService.handlePullRequestEvent).toHaveBeenCalledWith(body);
            expect(githubAppService.handleInstallationEvent).not.toHaveBeenCalled();
            expect(githubAppService.handleInstallationRepositoriesEvent).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('installation events dispatch to handleInstallationEvent', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.json(),
          async (bodyStr) => {
            const { controller, githubAppService } = createMocks();
            const body = JSON.parse(bodyStr);

            await (controller as any).dispatchEvent('installation', body);

            expect(githubAppService.handleInstallationEvent).toHaveBeenCalledTimes(1);
            expect(githubAppService.handleInstallationEvent).toHaveBeenCalledWith(body);
            expect(githubAppService.handlePullRequestEvent).not.toHaveBeenCalled();
            expect(githubAppService.handleInstallationRepositoriesEvent).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('installation_repositories events dispatch to handleInstallationRepositoriesEvent', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.json(),
          async (bodyStr) => {
            const { controller, githubAppService } = createMocks();
            const body = JSON.parse(bodyStr);

            await (controller as any).dispatchEvent('installation_repositories', body);

            expect(githubAppService.handleInstallationRepositoriesEvent).toHaveBeenCalledTimes(1);
            expect(githubAppService.handleInstallationRepositoriesEvent).toHaveBeenCalledWith(body);
            expect(githubAppService.handlePullRequestEvent).not.toHaveBeenCalled();
            expect(githubAppService.handleInstallationEvent).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Unrecognized event types have no side effects', () => {
    it('for any string NOT in the recognized set, no service handler method is called', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 100 }).filter(
            (s) => !RECOGNIZED_EVENTS.includes(s),
          ),
          fc.json(),
          async (eventType, bodyStr) => {
            const { controller, githubAppService } = createMocks();
            const body = JSON.parse(bodyStr);

            await (controller as any).dispatchEvent(eventType, body);

            expect(githubAppService.handlePullRequestEvent).not.toHaveBeenCalled();
            expect(githubAppService.handleInstallationEvent).not.toHaveBeenCalled();
            expect(githubAppService.handleInstallationRepositoriesEvent).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('empty string event type has no side effects', async () => {
      const { controller, githubAppService } = createMocks();

      await (controller as any).dispatchEvent('', {});

      expect(githubAppService.handlePullRequestEvent).not.toHaveBeenCalled();
      expect(githubAppService.handleInstallationEvent).not.toHaveBeenCalled();
      expect(githubAppService.handleInstallationRepositoriesEvent).not.toHaveBeenCalled();
    });
  });
});
