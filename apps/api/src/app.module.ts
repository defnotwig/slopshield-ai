// =============================================================================
// SlopShield AI — Root Application Module
// =============================================================================
// Composes all feature modules into a single NestJS application. ConfigModule
// is registered globally so every module can inject ConfigService without
// re-importing.  BullMQ is configured via REDIS_URL for the scan job queue.
// =============================================================================

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), "../../.env") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

import { Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { EventEmitterModule } from "@nestjs/event-emitter";
import IORedis from "ioredis";
import type { ConnectionOptions } from "bullmq";

import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { ScanModule } from "./scan/scan.module";
import { ProjectModule } from "./project/project.module";
import { RulesModule } from "./rules/rules.module";
import { FindingsModule } from "./findings/findings.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { LarkModule } from "./lark/lark.module";
import { AIReviewerModule } from "./ai-reviewer/ai-reviewer.module";
import { ScoringModule } from "./scoring/scoring.module";
import { ReportModule } from "./report/report.module";
import { NotificationModule } from "./notification/notification.module";
import { HealthModule } from "./health/health.module.js";
import {
  buildRedisConnection,
  attachRedisErrorLogger,
} from "./common/redis.js";

@Module({
  imports: [
    // -------------------------------------------------------------------------
    // ConfigModule — loads process.env and .env files, made globally available
    // so any service can inject ConfigService without re-importing.
    // -------------------------------------------------------------------------
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", ".env.local"],
    }),

    // -------------------------------------------------------------------------
    // BullModule — connects to Redis for the BullMQ job queue. Parses the
    // REDIS_URL environment variable into host and port.
    // -------------------------------------------------------------------------
    ...(process.env.QUEUE_MODE === "memory"
      ? []
      : [
          BullModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
              // Build the connection options from REDIS_URL (shape unchanged).
              const connection = buildRedisConnection(
                config.get<string>("REDIS_URL", "redis://localhost:6379"),
              );
              // Create a shared ioredis instance so we can attach an `error`
              // listener that logs descriptive Redis connection failures
              // (Requirement 12.3). The connection options are passed through
              // verbatim — buildRedisConnection's output shape is preserved.
              const redisLogger = new Logger("RedisConnection");
              const client = new IORedis(connection);
              attachRedisErrorLogger(client, redisLogger);
              return { connection: client as unknown as ConnectionOptions };
            },
          }),
        ]),

    // -------------------------------------------------------------------------
    // EventEmitter — in-process pub/sub for decoupled domain events such as
    // scan.completed, finding.created, etc.
    // -------------------------------------------------------------------------
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: ".",
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),

    // -------------------------------------------------------------------------
    // Feature modules — each encapsulates a bounded context of the application.
    // -------------------------------------------------------------------------
    PrismaModule,
    AuthModule,
    ScanModule,
    ProjectModule,
    RulesModule,
    FindingsModule,
    DashboardModule,
    LarkModule,
    AIReviewerModule,
    ScoringModule,
    ReportModule,
    NotificationModule,
    HealthModule,
  ],
})
export class AppModule {}
