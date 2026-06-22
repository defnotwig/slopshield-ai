import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), "../../.env") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

import { Module } from "@nestjs/common";
import { BullModule, getQueueToken } from "@nestjs/bullmq";
import { PrismaModule } from "../prisma/prisma.module.js";
import { ScannerModule } from "../scanner/scanner.module.js";
import { AIReviewerModule } from "../ai-reviewer/ai-reviewer.module.js";
import { ScoringModule } from "../scoring/scoring.module.js";
import { RulesModule } from "../rules/rules.module.js";
import { LarkModule } from "../lark/lark.module.js";
import { ReportModule } from "../report/report.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { NotificationModule } from "../notification/notification.module.js";

import { ScanService } from "./scan.service.js";
import { ScanController } from "./scan.controller.js";
import { ScanProcessor } from "./scan.processor.js";
import { ScanGateway } from "./scan.gateway.js";
import { GitHubIngestionService } from "./github-ingestion.service.js";

const isMemoryMode = process.env.QUEUE_MODE === "memory";

const queueProvider = {
  provide: getQueueToken("scan-pipeline"),
  useFactory: (processor: ScanProcessor) => {
    return {
      add: async (name: string, data: any) => {
        setTimeout(async () => {
          try {
            await processor.process({
              data,
              updateProgress: async () => {},
            } as any);
          } catch (err) {
            console.error("In-memory scan processor error:", err);
          }
        }, 0);
        return { id: "memory-job-" + Date.now() };
      },
    };
  },
  inject: [ScanProcessor],
};

@Module({
  imports: [
    PrismaModule,
    ScannerModule,
    AIReviewerModule,
    ScoringModule,
    RulesModule,
    LarkModule,
    ReportModule,
    AuthModule,
    NotificationModule,
    ...(isMemoryMode
      ? []
      : [
          BullModule.registerQueue({
            name: "scan-pipeline",
          }),
        ]),
  ],
  controllers: [ScanController],
  providers: [
    ScanService,
    ScanProcessor,
    ScanGateway,
    GitHubIngestionService,
    ...(isMemoryMode ? [queueProvider] : []),
  ],
  exports: [ScanService],
})
export class ScanModule {}
