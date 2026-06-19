import { Injectable, NotFoundException } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { PrismaService } from "../prisma/prisma.service.js";
import { AIReviewerService } from "../ai-reviewer/ai-reviewer.service.js";

@Injectable()
export class FindingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiReviewer: AIReviewerService,
  ) {}

  public async findOne(id: string): Promise<any> {
    const finding = await this.prisma.finding.findUnique({
      where: { id },
      include: {
        scanJob: {
          include: {
            project: true,
          },
        },
      },
    });

    if (!finding) {
      throw new NotFoundException(`Finding with ID ${id} not found`);
    }

    return finding;
  }

  public async markAsFalsePositive(id: string, value: boolean): Promise<any> {
    await this.findOne(id); // verify exists
    return this.prisma.finding.update({
      where: { id },
      data: { falsePositive: value },
    });
  }

  public async createFixTask(id: string, assignTo?: string): Promise<any> {
    const finding = await this.findOne(id);

    // Create a local FixTask in the database
    return this.prisma.fixTask.create({
      data: {
        findingId: id,
        assignedTo: assignTo || null,
        title: `Fix finding: ${finding.title}`,
        description: `Please resolve the following issue: ${finding.description || ""}\n\nFile: ${finding.filePath}\nLine: ${finding.lineNumber}\nRecommendation: ${finding.recommendation || ""}`,
        status: "open",
      },
    });
  }

  public async generateFixPlan(id: string): Promise<string[]> {
    const finding = await this.findOne(id);

    // Retrieve file content if possible
    let codeContext = "";
    if (finding.filePath) {
      try {
        const tempBase = path.join(
          process.cwd(),
          "temp-scans",
          finding.scanJobId,
        );
        const filePath = path.join(tempBase, finding.filePath);
        if (fs.existsSync(filePath)) {
          codeContext = fs.readFileSync(filePath, "utf8");
        }
      } catch {
        // Fallback to codeSnippet
      }
    }

    if (!codeContext && finding.codeSnippet) {
      codeContext = `// Source file context snippet:\n${finding.codeSnippet}`;
    }

    return this.aiReviewer.generateFixPlan([finding as any], codeContext);
  }
}
