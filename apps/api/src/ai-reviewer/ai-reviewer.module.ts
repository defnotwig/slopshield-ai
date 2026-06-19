import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { RulesModule } from "../rules/rules.module.js";
import { GeminiProvider } from "./providers/gemini.provider.js";
import { AIReviewerService } from "./ai-reviewer.service.js";

@Module({
  imports: [ConfigModule, RulesModule],
  providers: [GeminiProvider, AIReviewerService],
  exports: [AIReviewerService],
})
export class AIReviewerModule {}
