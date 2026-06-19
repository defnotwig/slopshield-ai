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

import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { EventEmitterModule } from "@nestjs/event-emitter";

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
              const redisUrl = config.get<string>(
                "REDIS_URL",
                "redis://localhost:6379",
              );
              const url = new URL(redisUrl);
              return {
                connection: {
                  host: url.hostname,
                  port: parseInt(url.port, 10) || 6379,
                  password: url.password || undefined,
                },
              };
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
  ],
})
export class AppModule {}
