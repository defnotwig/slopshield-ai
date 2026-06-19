import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { PrismaService } from "../prisma/prisma.service.js";
import { Rule } from "@slopshield/shared";

@Injectable()
export class RulesService implements OnModuleInit {
  private readonly logger = new Logger(RulesService.name);
  private rulesCache: Map<string, Rule> = new Map();

  constructor(private readonly prisma: PrismaService) {}

  public async onModuleInit(): Promise<void> {
    await this.loadRulesFromDisk();
  }

  /**
   * Loads the base rules from the rules YAML configuration directory and caches/synchronises them in the database.
   */
  public async loadRulesFromDisk(): Promise<void> {
    try {
      const rulesDir = path.join(process.cwd(), "rules");
      if (!fs.existsSync(rulesDir)) {
        this.logger.warn(`Rules directory not found at: ${rulesDir}`);
        return;
      }

      const files = fs
        .readdirSync(rulesDir)
        .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"));
      this.logger.log(`Found ${files.length} rules configuration files.`);

      for (const file of files) {
        const filePath = path.join(rulesDir, file);
        const fileContent = fs.readFileSync(filePath, "utf8");
        const parsedDoc: any = yaml.load(fileContent);

        if (parsedDoc && Array.isArray(parsedDoc.rules)) {
          for (const ruleData of parsedDoc.rules) {
            // Upsert in DB
            const dbRule = await this.prisma.rule.upsert({
              where: { ruleId: ruleData.rule_id },
              update: {
                title: ruleData.title,
                category: ruleData.category,
                severity: ruleData.severity,
                appliesTo: ruleData.applies_to,
                standards: ruleData.standards,
                blocking: ruleData.blocking ?? false,
              },
              create: {
                ruleId: ruleData.rule_id,
                title: ruleData.title,
                category: ruleData.category,
                severity: ruleData.severity,
                appliesTo: ruleData.applies_to,
                standards: ruleData.standards,
                blocking: ruleData.blocking ?? false,
                enabled: ruleData.enabled ?? true,
              },
            });

            this.rulesCache.set(dbRule.ruleId, {
              rule_id: dbRule.ruleId,
              title: dbRule.title,
              category: dbRule.category,
              severity: dbRule.severity as any,
              applies_to: dbRule.appliesTo as any,
              standards: dbRule.standards as string[],
              blocking: dbRule.blocking,
              enabled: dbRule.enabled,
              description: ruleData.description || "",
              recommendation: ruleData.recommendation || "",
              detection: ruleData.detection,
            });
          }
        }
      }

      this.logger.log(`Loaded and cached ${this.rulesCache.size} rules.`);
    } catch (err: any) {
      this.logger.error(`Failed to load rules: ${err.message}`, err.stack);
    }
  }

  public async getAllRules(): Promise<Rule[]> {
    // Load rules from DB to pick up any runtime toggles
    const dbRules = await this.prisma.rule.findMany();
    return dbRules.map((dbRule: any) => {
      const cached = this.rulesCache.get(dbRule.ruleId);
      return {
        rule_id: dbRule.ruleId,
        title: dbRule.title,
        category: dbRule.category,
        severity: dbRule.severity as any,
        applies_to: dbRule.appliesTo as any,
        standards: dbRule.standards as string[],
        blocking: dbRule.blocking,
        enabled: dbRule.enabled,
        description: cached?.description || "",
        recommendation: cached?.recommendation || "",
        detection: cached?.detection,
      };
    });
  }

  public async getRuleById(ruleId: string): Promise<Rule | null> {
    const dbRule = await this.prisma.rule.findUnique({
      where: { ruleId },
    });
    if (!dbRule) return null;

    const cached = this.rulesCache.get(dbRule.ruleId);
    return {
      rule_id: dbRule.ruleId,
      title: dbRule.title,
      category: dbRule.category,
      severity: dbRule.severity as any,
      applies_to: dbRule.appliesTo as any,
      standards: dbRule.standards as string[],
      blocking: dbRule.blocking,
      enabled: dbRule.enabled,
      description: cached?.description || "",
      recommendation: cached?.recommendation || "",
      detection: cached?.detection,
    };
  }

  public async updateRule(ruleId: string, data: Partial<Rule>): Promise<Rule> {
    const updated = await this.prisma.rule.update({
      where: { ruleId },
      data: {
        title: data.title,
        severity: data.severity,
        blocking: data.blocking,
        enabled: data.enabled,
      },
    });

    const cached = this.rulesCache.get(ruleId);
    const updatedCached = {
      rule_id: updated.ruleId,
      title: updated.title,
      category: updated.category,
      severity: updated.severity as any,
      applies_to: updated.appliesTo as any,
      standards: updated.standards as string[],
      blocking: updated.blocking,
      enabled: updated.enabled,
      description: cached?.description || "",
      recommendation: cached?.recommendation || "",
      detection: cached?.detection,
    };

    this.rulesCache.set(ruleId, updatedCached);
    return updatedCached;
  }

  public async enableRule(ruleId: string): Promise<Rule> {
    return this.updateRule(ruleId, { enabled: true } as any);
  }

  public async disableRule(ruleId: string): Promise<Rule> {
    return this.updateRule(ruleId, { enabled: false } as any);
  }
}
