// =============================================================================
// SlopShield AI — GitHub App Module
// =============================================================================
// Registers the GitHub App integration components: webhook controller, services,
// rate limiter, and repository config management. This module requires the
// 'scan-pipeline' BullMQ queue for enqueuing PR-triggered scans.
//
// Conditional registration based on GITHUB_APP_ENABLED is handled by the root
// AppModule (task 8.5) — this module registers everything it needs regardless.
//
// Requirements: 11.3
// =============================================================================

import * as dotenv from 'dotenv';
import * as path from 'node:path';
dotenv.config({ path: path.join(process.cwd(), '../../.env') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';

import { WebhookController } from './webhook.controller';
import { RepositoryConfigController } from './repository-config.controller';
import { GitHubAppService } from './github-app.service';
import { GitHubTokenService } from './github-token.service';
import { WebhookRateLimiter } from './webhook-rate-limiter.service';
import { RepositoryConfigService } from './repository-config.service';

const isMemoryMode = process.env.QUEUE_MODE === 'memory';

/**
 * In memory mode, provide a minimal queue stub so that @InjectQueue('scan-pipeline')
 * resolves without a real Redis-backed BullMQ queue. The stub mimics the Queue API
 * enough to satisfy GitHubAppService.
 */
const memoryQueueProvider = {
  provide: getQueueToken('scan-pipeline'),
  useValue: {
    add: async (name: string, data: any) => {
      return { id: 'memory-job-' + Date.now() };
    },
  },
};

@Module({
  imports: [
    // Register the scan-pipeline BullMQ queue when running in Redis mode.
    // In memory mode, a stub provider is used instead.
    ...(isMemoryMode
      ? []
      : [
          BullModule.registerQueue({
            name: 'scan-pipeline',
          }),
        ]),
  ],
  controllers: [WebhookController, RepositoryConfigController],
  providers: [
    GitHubAppService,
    GitHubTokenService,
    WebhookRateLimiter,
    RepositoryConfigService,
    ...(isMemoryMode ? [memoryQueueProvider] : []),
  ],
  exports: [GitHubAppService, GitHubTokenService, RepositoryConfigService],
})
export class GitHubAppModule {}
