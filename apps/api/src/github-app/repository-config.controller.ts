/**
 * RepositoryConfigController — REST endpoint for per-repository configuration
 * CRUD operations. Provides GET (read config or defaults) and PUT (upsert
 * config with validation).
 *
 * The `:repoFullName` contains a `/` (e.g., "owner/repo"), so we use separate
 * `:owner` and `:repo` route params and combine them internally.
 *
 * Authentication: Requires JWT auth and admin or team-lead role.
 * Audit logging: Handled by RepositoryConfigService.upsertConfig.
 *
 * Requirements: 5.3, 5.4, 5.7
 */

import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import {
  RepositoryConfigService,
  RepositoryConfig,
  RepositoryConfigInput,
} from './repository-config.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('repositories')
export class RepositoryConfigController {
  constructor(
    private readonly repoConfigService: RepositoryConfigService,
  ) {}

  /**
   * GET /repositories/:owner/:repo/config
   *
   * Returns the repository config for the given repo, or default values
   * if no config record exists.
   */
  @Get(':owner/:repo/config')
  async getConfig(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ): Promise<RepositoryConfig> {
    const repoFullName = `${owner}/${repo}`;
    return this.repoConfigService.getConfig(repoFullName);
  }

  /**
   * PUT /repositories/:owner/:repo/config
   *
   * Updates (or creates) the repository config. Validates input fields
   * and records changes in the audit log.
   *
   * Requires admin or team-lead role.
   */
  @Roles('admin', 'team-lead')
  @Put(':owner/:repo/config')
  async updateConfig(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body() body: Partial<RepositoryConfigInput>,
  ): Promise<RepositoryConfig> {
    const repoFullName = `${owner}/${repo}`;
    return this.repoConfigService.upsertConfig(repoFullName, body);
  }
}
