import { Injectable } from "@nestjs/common";
import type {
  DashboardSummary,
  DashboardTrendPoint,
  TopIssue,
  StandardViolation,
  FindingCategory,
} from "@slopshield/shared";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Human-readable titles for each finding category. Used to populate
 * `TopIssue.title` so the Web_App can render a label without re-deriving it
 * from the raw category slug.
 */
const CATEGORY_TITLES: Record<FindingCategory, string> = {
  "backend-security": "Backend Security",
  "frontend-security": "Frontend Security",
  "backend-architecture": "Backend Architecture",
  "frontend-architecture": "Frontend Architecture",
  maintainability: "Maintainability",
  testability: "Testability",
  accessibility: "Accessibility",
  reliability: "Reliability",
  documentation: "Documentation",
  general: "General",
};

function titleForCategory(category: string): string {
  return CATEGORY_TITLES[category as FindingCategory] ?? category;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  public async getSummary(projectId?: string): Promise<DashboardSummary> {
    const filter: any = projectId ? { projectId } : {};

    const totalScans = await this.prisma.scanJob.count({
      where: filter,
    });

    const completedScans = await this.prisma.scanJob.findMany({
      where: {
        ...filter,
        status: "completed",
        overallScore: { not: null },
      },
      select: {
        overallScore: true,
      },
    });

    const averageScore =
      completedScans.length > 0
        ? Math.round(
            completedScans.reduce(
              (acc: number, curr: any) => acc + (curr.overallScore || 0),
              0,
            ) / completedScans.length,
          )
        : 100;

    const blockedScans = await this.prisma.scanJob.count({
      where: {
        ...filter,
        statusResult: "blocked",
      },
    });

    const passedScans = await this.prisma.scanJob.count({
      where: {
        ...filter,
        statusResult: "passed",
      },
    });

    const warningScans = await this.prisma.scanJob.count({
      where: {
        ...filter,
        statusResult: "passed-with-warnings",
      },
    });

    return {
      totalScans,
      averageScore,
      blockedScans,
      passedScans,
      warningScans,
    };
  }

  public async getTrends(projectId?: string): Promise<DashboardTrendPoint[]> {
    const filter: any = projectId ? { projectId } : {};

    // Get last 20 completed scans with scores
    const scans = await this.prisma.scanJob.findMany({
      where: {
        ...filter,
        status: "completed",
        overallScore: { not: null },
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        overallScore: true,
      },
    });

    return scans.map((s: any) => ({
      scanId: s.id,
      date: s.createdAt.toISOString().split("T")[0],
      score: s.overallScore,
    }));
  }

  public async getTopIssues(projectId?: string): Promise<TopIssue[]> {
    const filter: any = projectId ? { scanJob: { projectId } } : {};

    // Group findings by category
    const categoriesGroup = await this.prisma.finding.groupBy({
      by: ["category"],
      where: {
        ...filter,
        falsePositive: false,
      },
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: "desc",
        },
      },
    });

    return categoriesGroup.map((g: any) => ({
      category: g.category,
      title: titleForCategory(g.category),
      count: g._count.id,
    }));
  }

  public async getStandardsViolations(
    projectId?: string,
  ): Promise<StandardViolation[]> {
    const filter: any = projectId ? { scanJob: { projectId } } : {};

    const findings = await this.prisma.finding.findMany({
      where: {
        ...filter,
        falsePositive: false,
        standardReferences: { isEmpty: false },
      },
      select: {
        standardReferences: true,
      },
    });

    // A finding can now map to multiple standards — count every reference.
    const standardsMap: Record<string, number> = {};
    for (const f of findings) {
      for (const ref of f.standardReferences ?? []) {
        if (ref) {
          standardsMap[ref] = (standardsMap[ref] || 0) + 1;
        }
      }
    }

    return Object.entries(standardsMap)
      .map(([standard, count]) => ({
        standard,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }
}
