/**
 * WebhookController — Receives GitHub webhook POST requests, verifies their
 * HMAC-SHA256 signatures, and dispatches events asynchronously to the
 * GitHubAppService for processing.
 *
 * The controller acknowledges valid webhooks immediately (within 10s per
 * GitHub requirements) and fires off processing in the background.
 *
 * HTTP responses:
 * - 200: Event acknowledged (valid signature, or unrecognized event type)
 * - 401: Invalid or missing HMAC signature
 * - 429: Rate limit exceeded for scan-triggering events
 * - 503: Webhook secret not configured (service unavailable)
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 8.2, 8.5
 */

import {
  Controller,
  Post,
  Req,
  Res,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { GitHubAppService } from './github-app.service';
import { WebhookRateLimiter } from './webhook-rate-limiter.service';
import { verifyWebhookSignature } from './webhook-signature';
import { loadGitHubAppConfig } from './github-app.config';
import {
  GitHubEventType,
  PullRequestEventPayload,
  InstallationEventPayload,
  InstallationReposEventPayload,
} from './types';

/** Recognized event types that have dedicated handler methods. */
const RECOGNIZED_EVENTS: Set<string> = new Set([
  'pull_request',
  'installation',
  'installation_repositories',
]);

@Controller('webhooks/github')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly githubAppService: GitHubAppService,
    private readonly rateLimiter: WebhookRateLimiter,
  ) {}

  /**
   * Receives all GitHub webhook events. Verifies HMAC-SHA256 signature,
   * acknowledges immediately with 200, and dispatches async processing.
   *
   * Returns 401 on invalid signature, 503 if webhook secret not configured,
   * 429 if rate-limited for scan-triggering events.
   */
  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Res() res: Response,
  ): Promise<void> {
    const config = loadGitHubAppConfig();

    // Step 1: Check if webhook secret is configured (Req 1.4 → 503)
    if (!config.webhookSecret) {
      res.status(503).json({
        statusCode: 503,
        message: 'Webhook processing is unavailable: secret not configured',
      });
      return;
    }

    // Step 2: Get raw body and signature header
    const rawBody = req.rawBody;
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const eventType = req.headers['x-github-event'] as string | undefined;

    // Step 3: Reject if no signature header (Req 1.2, 1.3 → 401)
    if (!signature) {
      res.status(401).json({
        statusCode: 401,
        message: 'Missing X-Hub-Signature-256 header',
      });
      return;
    }

    // Step 4: Verify HMAC signature (Req 1.2, 1.3 → 401 on failure)
    if (!rawBody || !verifyWebhookSignature(rawBody, signature, config.webhookSecret)) {
      res.status(401).json({
        statusCode: 401,
        message: 'Invalid webhook signature',
      });
      return;
    }

    // Step 5: Parse the body
    let body: any;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({
        statusCode: 400,
        message: 'Malformed JSON body',
      });
      return;
    }

    // Step 6: For scan-triggering events (pull_request), check rate limit (Req 8.2, 8.5)
    if (eventType === 'pull_request' && !this.rateLimiter.isExempt(eventType)) {
      const installationId = body?.installation?.id;
      if (installationId) {
        const rateLimitResult = await this.rateLimiter.checkAllowed(installationId);
        if (!rateLimitResult.allowed) {
          this.logger.warn(
            `Rate limit exceeded for installation ${installationId}, ` +
            `reason: ${rateLimitResult.reason}, event: ${eventType}`,
          );
          res.status(429).json({
            statusCode: 429,
            message: `Rate limit exceeded: ${rateLimitResult.reason}`,
            retryAfter: 60,
          });
          return;
        }
      }
    }

    // Step 7: Respond immediately with 200 (Req 1.7 — acknowledge within 10s)
    res.status(200).json({ received: true });

    // Step 8: Dispatch asynchronously based on event type (fire-and-forget)
    setImmediate(() => {
      this.dispatchEvent(eventType || '', body).catch((err) => {
        this.logger.error(
          `Error processing webhook event "${eventType}": ${(err as Error).message}`,
          (err as Error).stack,
        );
      });
    });
  }

  /**
   * Dispatch a verified webhook event to the appropriate service method.
   * Unrecognized events are logged and ignored (Req 1.6).
   */
  private async dispatchEvent(eventType: string, body: any): Promise<void> {
    if (!RECOGNIZED_EVENTS.has(eventType)) {
      this.logger.debug(`Unrecognized webhook event type: "${eventType}" — ignoring`);
      return;
    }

    switch (eventType as GitHubEventType) {
      case 'pull_request':
        await this.githubAppService.handlePullRequestEvent(
          body as PullRequestEventPayload,
        );
        break;

      case 'installation':
        await this.githubAppService.handleInstallationEvent(
          body as InstallationEventPayload,
        );
        break;

      case 'installation_repositories':
        await this.githubAppService.handleInstallationRepositoriesEvent(
          body as InstallationReposEventPayload,
        );
        break;
    }
  }
}
