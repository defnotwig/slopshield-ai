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
      datasourceUrl: process.env.DATABASE_URL,
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

    // Log connection errors for observability (Neon drops idle connections)
    // @ts-expect-error — Prisma $on('error') requires generated client types
    this.$on("error", (event: unknown) => {
      this.logger.warn(`Prisma connection event: ${JSON.stringify(event)}`);
    });

    try {
      await this.$connect();
      this.logger.log("PostgreSQL connection established.");
    } catch (error) {
      // Log a descriptive connection error WITHOUT leaking the DATABASE_URL,
      // which contains host and credentials. Only the error message is logged.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to connect to PostgreSQL. Verify DATABASE_URL includes required Neon params: ?pgbouncer=true&connect_timeout=15&pool_timeout=15&connection_limit=5. Cause: ${message}`,
      );
      // Re-throw so Nest aborts boot (existing fail-fast behavior).
      throw error;
    }
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
