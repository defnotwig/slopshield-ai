import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CustomRule, CustomRuleListSchema } from "@slopshield/shared";

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

  public async create(data: any): Promise<any> {
    return this.prisma.project.create({ data });
  }

  public async findAll(): Promise<any[]> {
    return this.prisma.project.findMany({
      include: {
        _count: {
          select: { scanJobs: true },
        },
      },
    });
  }

  public async findOne(id: string): Promise<any> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        scanJobs: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project;
  }

  public async update(id: string, data: any): Promise<any> {
    await this.findOne(id); // Throws if not found
    return this.prisma.project.update({
      where: { id },
      data,
    });
  }

  public async remove(id: string): Promise<any> {
    await this.findOne(id);
    return this.prisma.project.delete({
      where: { id },
    });
  }

  /** Return the project's validated custom rules (empty when unset/malformed). */
  public async getCustomRules(id: string): Promise<CustomRule[]> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: { customRules: true },
    });
    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }
    const parsed = CustomRuleListSchema.safeParse(project.customRules ?? []);
    return parsed.success ? parsed.data : [];
  }

  /** Validate and persist the project's custom rules; rejects malformed input. */
  public async setCustomRules(
    id: string,
    rules: unknown,
  ): Promise<CustomRule[]> {
    await this.findOne(id); // throws if not found
    const parsed = CustomRuleListSchema.safeParse(rules);
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid custom rules: ${parsed.error.message}`,
      );
    }
    await this.prisma.project.update({
      where: { id },
      data: { customRules: parsed.data as any },
    });
    return parsed.data;
  }
}
