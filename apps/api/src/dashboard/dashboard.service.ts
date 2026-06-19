import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  public async getSummary(projectId?: string): Promise<any> {
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

    const avgScore =
      completedScans.length > 0
        ? Math.round(
            completedScans.reduce(
              (acc: number, curr: any) => acc + (curr.overallScore || 0),
              0,
            ) / completedScans.length,
          )
        : 100;

    const blockedCount = await this.prisma.scanJob.count({
      where: {
        ...filter,
        statusResult: "blocked",
      },
    });

    const passedCount = await this.prisma.scanJob.count({
      where: {
        ...filter,
        statusResult: { in: ["passed", "passed-with-warnings"] },
      },
    });

    return {
      totalScans,
      avgScore,
      blockedCount,
      passedCount,
    };
  }

  public async getTrends(projectId?: string): Promise<any[]> {
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

  public async getTopIssues(projectId?: string): Promise<any[]> {
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
      count: g._count.id,
    }));
  }

  public async getStandardsViolations(projectId?: string): Promise<any[]> {
    const filter: any = projectId ? { scanJob: { projectId } } : {};

    const findings = await this.prisma.finding.findMany({
      where: {
        ...filter,
        falsePositive: false,
        standardReference: { not: null },
      },
      select: {
        standardReference: true,
      },
    });

    const standardsMap: Record<string, number> = {};
    for (const f of findings) {
      if (f.standardReference) {
        standardsMap[f.standardReference] =
          (standardsMap[f.standardReference] || 0) + 1;
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
