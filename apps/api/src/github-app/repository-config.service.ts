import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ScanMode, ALLOWED_SCAN_MODES } from './types.js';

// ---------------------------------------------------------------------------
// Input interface
// ---------------------------------------------------------------------------

/** Fields accepted when creating or updating a repository config. */
export interface RepositoryConfigInput {
  scanThreshold: number;
  scanMode: ScanMode;
  autoBlockEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Output interface (matches Prisma model shape)
// ---------------------------------------------------------------------------

export interface RepositoryConfig {
  id: string;
  repoFullName: string;
  installationId: string | null;
  scanThreshold: number;
  scanMode: string;
  autoBlockEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Manages per-repository configuration for the GitHub App integration.
 *
 * Provides default config values when no record exists, validates input,
 * and records changes in the audit log.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */
@Injectable()
export class RepositoryConfigService {
  private readonly logger = new Logger(RepositoryConfigService.name);

  /** Default config applied when no per-repo config exists. */
  static readonly DEFAULTS = {
    scanThreshold: 70,
    scanMode: 'full' as ScanMode,
    autoBlockEnabled: true,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Get config for a repository, returning defaults if none exists.
   *
   * Validates: Requirement 5.2
   */
  async getConfig(repoFullName: string): Promise<RepositoryConfig> {
    const existing = await this.prisma.repositoryConfig.findUnique({
      where: { repoFullName },
    });

    if (existing) {
      return existing;
    }

    // Return a default config object (not persisted until explicitly created)
    return {
      id: '',
      repoFullName,
      installationId: null,
      scanThreshold: RepositoryConfigService.DEFAULTS.scanThreshold,
      scanMode: RepositoryConfigService.DEFAULTS.scanMode,
      autoBlockEnabled: RepositoryConfigService.DEFAULTS.autoBlockEnabled,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Create or update a repository's config. Validates threshold and scanMode
   * if provided. Records the change in the audit log.
   *
   * Validates: Requirements 5.3, 5.4, 5.7
   */
  async upsertConfig(
    repoFullName: string,
    update: Partial<RepositoryConfigInput>,
  ): Promise<RepositoryConfig> {
    // Validate fields if provided
    if (update.scanThreshold !== undefined) {
      update.scanThreshold = this.validateThreshold(update.scanThreshold);
    }
    if (update.scanMode !== undefined) {
      update.scanMode = this.validateScanMode(update.scanMode);
    }

    const data: Record<string, unknown> = {};
    if (update.scanThreshold !== undefined) data.scanThreshold = update.scanThreshold;
    if (update.scanMode !== undefined) data.scanMode = update.scanMode;
    if (update.autoBlockEnabled !== undefined) data.autoBlockEnabled = update.autoBlockEnabled;

    const result = await this.prisma.repositoryConfig.upsert({
      where: { repoFullName },
      create: {
        repoFullName,
        scanThreshold: (data.scanThreshold as number) ?? RepositoryConfigService.DEFAULTS.scanThreshold,
        scanMode: (data.scanMode as string) ?? RepositoryConfigService.DEFAULTS.scanMode,
        autoBlockEnabled: (data.autoBlockEnabled as boolean) ?? RepositoryConfigService.DEFAULTS.autoBlockEnabled,
      },
      update: data,
    });

    // Record the config change in the audit log (Req 5.7)
    await this.auditService.record({
      action: 'repository-config.update',
      target: repoFullName,
      metadata: {
        updatedFields: Object.keys(data),
        newValues: data,
      },
    });

    this.logger.log(`Repository config upserted for ${repoFullName}`);

    return result;
  }

  /**
   * Validate that a scan threshold is an integer in [0, 100].
   * Throws BadRequestException if invalid.
   *
   * Pure function suitable for property testing.
   * Validates: Requirement 5.3
   */
  validateThreshold(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new BadRequestException(
        `scanThreshold must be an integer, received: ${JSON.stringify(value)}`,
      );
    }
    if (value < 0 || value > 100) {
      throw new BadRequestException(
        `scanThreshold must be between 0 and 100 inclusive, received: ${value}`,
      );
    }
    return value;
  }

  /**
   * Validate that a scan mode is one of the allowed values.
   * Throws BadRequestException if invalid.
   *
   * Pure function suitable for property testing.
   * Validates: Requirement 5.4
   */
  validateScanMode(value: unknown): ScanMode {
    if (typeof value !== 'string' || !ALLOWED_SCAN_MODES.includes(value as ScanMode)) {
      throw new BadRequestException(
        `scanMode must be one of [${ALLOWED_SCAN_MODES.join(', ')}], received: ${JSON.stringify(value)}`,
      );
    }
    return value as ScanMode;
  }
}
