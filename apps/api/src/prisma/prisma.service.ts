// =============================================================================
// SlopShield AI — Prisma Service
// =============================================================================
// Extends the auto-generated PrismaClient so NestJS can manage its lifecycle.
// onModuleInit connects to the database at startup; onModuleDestroy
// disconnects gracefully on shutdown.
// =============================================================================

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: "event", level: "query" },
        { emit: "stdout", level: "info" },
        { emit: "stdout", level: "warn" },
        { emit: "stdout", level: "error" },
      ],
    });
  }

  /**
   * Called by NestJS after dependency injection is complete.
   * Opens the connection pool to PostgreSQL.
   */
  async onModuleInit(): Promise<void> {
    this.logger.log("Connecting to PostgreSQL via Prisma…");
    await this.$connect();
    this.logger.log("PostgreSQL connection established.");
  }

  /**
   * Called by NestJS during application shutdown.
   * Drains the connection pool cleanly.
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log("Disconnecting from PostgreSQL…");
    await this.$disconnect();
    this.logger.log("PostgreSQL connection closed.");
  }
}
