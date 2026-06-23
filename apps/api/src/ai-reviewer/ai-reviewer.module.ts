import { Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { RulesModule } from "../rules/rules.module.js";
import { GeminiProvider } from "./providers/gemini.provider.js";
import { OllamaProvider } from "./providers/ollama.provider.js";
import { AIReviewerService } from "./ai-reviewer.service.js";
import { AI_REVIEWER_PROVIDER } from "./ai-reviewer.constants.js";
import { resolveAiProvider } from "./providers/provider.factory.js";

@Module({
  imports: [ConfigModule, RulesModule],
  providers: [
    GeminiProvider,
    OllamaProvider,
    {
      provide: AI_REVIEWER_PROVIDER,
      inject: [ConfigService, GeminiProvider, OllamaProvider],
      useFactory: (config: ConfigService, gemini: GeminiProvider, ollama: OllamaProvider) =>
        resolveAiProvider(config.get('AI_PROVIDER'), gemini, ollama, new Logger('AIProviderFactory')),
    },
    AIReviewerService,
  ],
  exports: [AIReviewerService],
})
export class AIReviewerModule {}
