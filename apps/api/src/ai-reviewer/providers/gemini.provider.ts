import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import {
  Finding,
  AIReviewResult,
  AIReviewResultSchema,
} from "@slopshield/shared";
import {
  AIReviewerProvider,
  ReviewInput,
} from "../interfaces/ai-reviewer-provider.interface.js";
import { AI_REVIEWER_SYSTEM_PROMPT } from "../prompts/system-prompt.js";

@Injectable()
export class GeminiProvider implements AIReviewerProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private ai: GoogleGenAI | null = null;
  private readonly modelName: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("GEMINI_API_KEY");
    this.modelName = this.configService.get<string>(
      "GEMINI_MODEL",
      "gemini-2.5-pro",
    );

    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
      this.logger.log(
        `GeminiProvider initialized with model: ${this.modelName}`,
      );
    } else {
      this.logger.warn(
        "GEMINI_API_KEY is not defined. AI Reviewer will operate in mock mode.",
      );
    }
  }

  public async reviewCode(input: ReviewInput): Promise<AIReviewResult> {
    if (!this.ai) {
      this.logger.warn(
        "Gemini AI client not initialized (missing API key). Returning mock review.",
      );
      return this.getMockReviewResult(input);
    }

    const codeContext = input.files
      .map(
        (f) =>
          `=== FILE: ${f.path} ===\nLanguage: ${f.language}\n\n${f.content}\n=== END FILE ===`,
      )
      .join("\n\n");

    const prompt = `Please review the following files from scan ID ${input.scanId}:\n\n${codeContext}`;

    let retries = 2;
    while (retries >= 0) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.modelName,
          contents: prompt,
          config: {
            systemInstruction: AI_REVIEWER_SYSTEM_PROMPT,
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        });

        const text = response.text;
        if (!text) {
          throw new Error("Gemini returned an empty response text.");
        }

        const parsed = JSON.parse(text);
        const validated = AIReviewResultSchema.parse(parsed);
        return validated;
      } catch (err: any) {
        this.logger.warn(
          `Gemini review failed. Retries remaining: ${retries}. Error: ${err.message || err}`,
        );
        retries--;
        if (retries < 0) {
          throw new Error(
            `AI review failed after multiple attempts: ${err.message || err}`,
          );
        }
      }
    }

    return this.getMockReviewResult(input);
  }

  public async generateFixPlan(
    findings: Finding[],
    codeContext: string,
  ): Promise<string[]> {
    if (!this.ai) {
      return [
        "Verify environment variables.",
        "Mock plan: resolve findings manually.",
      ];
    }

    const findingsDesc = findings
      .map(
        (f, i) =>
          `${i + 1}. [${f.severity}] ${f.title} in ${f.file}${f.line ? `:${f.line}` : ""}\nWhy: ${f.whyItMatters}\nRec: ${f.recommendation}`,
      )
      .join("\n\n");

    const prompt = `Given the following findings detected in a code scan:\n\n${findingsDesc}\n\nAnd the code context:\n\n${codeContext}\n\nProvide an ordered, step-by-step refactoring plan to resolve these findings. Return the plan as a JSON string array. Example: ["Step 1...", "Step 2..."]`;

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          systemInstruction:
            "You are a Senior Principal Engineer. Provide a concise, step-by-step technical fix plan. Output ONLY a valid JSON string array.",
          responseMimeType: "application/json",
        },
      });

      const text = response.text;
      if (text) {
        return JSON.parse(text) as string[];
      }
    } catch (err: any) {
      this.logger.error(
        `Failed to generate fix plan via Gemini: ${err.message}`,
      );
    }

    return [
      "Resolve security findings first.",
      "Implement missing validation schemas.",
      "Update test files to verify changes.",
    ];
  }

  public async summarizeForLark(scanReport: any): Promise<string> {
    if (!this.ai) {
      return `Scan finished with score: ${scanReport.overallScore}. Status: ${scanReport.statusResult}. Total findings: ${scanReport.totalFindings}.`;
    }

    const prompt = `Summarize this code quality report in a single, short paragraph for a team notification chat:\n\n${JSON.stringify(scanReport)}`;

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          systemInstruction:
            "You are a technical product manager. Provide a single, extremely punchy, direct summary of the scan results. Focus on blocking or critical items. Do not exceed 3 sentences.",
        },
      });

      return response.text?.trim() || "No summary generated.";
    } catch (err: any) {
      this.logger.error(`Failed to summarize report for Lark: ${err.message}`);
      return `Scan score: ${scanReport.overallScore}. Status: ${scanReport.statusResult}.`;
    }
  }

  private getMockReviewResult(input: ReviewInput): AIReviewResult {
    return {
      summary:
        "Mock analysis report. Set GEMINI_API_KEY environment variable to enable full AI-assisted scan features.",
      findings: [],
      recommended_tests: ["Add unit tests for all updated modules."],
      refactor_plan: [
        "Configure GEMINI_API_KEY in .env file.",
        "Rerun scan to trigger AI review analysis.",
      ],
    };
  }
}
