import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { EmailService } from "./email.service.js";

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Retrieves notification settings for a user. Creates default if none exists.
   */
  public async getSettings(userId: string): Promise<any> {
    let settings = await this.prisma.notificationSetting.findUnique({
      where: { userId },
    });

    if (!settings) {
      settings = await this.prisma.notificationSetting.create({
        data: {
          userId,
          emailAlerts: true,
          slackAlerts: false,
          larkAlerts: true,
          minSeverity: "high",
        },
      });
    }

    return settings;
  }

  /**
   * Updates notification settings for a user.
   */
  public async updateSettings(userId: string, data: any): Promise<any> {
    await this.getSettings(userId); // Ensure record exists
    return this.prisma.notificationSetting.update({
      where: { userId },
      data: {
        emailAlerts: data.emailAlerts,
        slackAlerts: data.slackAlerts,
        larkAlerts: data.larkAlerts,
        minSeverity: data.minSeverity,
      },
    });
  }

  /**
   * Lists all members of a project.
   */
  public async listProjectMembers(projectId: string): Promise<any[]> {
    return this.prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });
  }

  /**
   * Adds a user to a project as a member by email address.
   */
  public async addProjectMember(
    projectId: string,
    email: string,
    role: string,
  ): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException(`User with email ${email} not found`);
    }

    const existingMember = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: user.id,
        },
      },
    });

    if (existingMember) {
      throw new BadRequestException("User is already a member of this project");
    }

    return this.prisma.projectMember.create({
      data: {
        projectId,
        userId: user.id,
        role: role || "member",
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });
  }

  /**
   * Removes a member from a project.
   */
  public async removeProjectMember(
    projectId: string,
    memberId: string,
  ): Promise<any> {
    const member = await this.prisma.projectMember.findFirst({
      where: {
        id: memberId,
        projectId,
      },
    });

    if (!member) {
      throw new NotFoundException(
        `Membership relationship with ID ${memberId} not found in this project`,
      );
    }

    return this.prisma.projectMember.delete({
      where: { id: memberId },
    });
  }

  /**
   * Analyzes a completed scan and pushes alerts to workspace members.
   */
  public async processScanNotifications(scanId: string): Promise<void> {
    try {
      const scan = await this.prisma.scanJob.findUnique({
        where: { id: scanId },
        include: {
          project: true,
          findings: {
            where: { falsePositive: false },
          },
        },
      });

      if (!scan || !scan.projectId) {
        this.logger.log(
          `Scan ${scanId} is not linked to a project; skipping alerts.`,
        );
        return;
      }

      const project = scan.project;
      if (!project) {
        this.logger.log(
          `Scan ${scanId} has no project relation; skipping alerts.`,
        );
        return;
      }

      const members = await this.listProjectMembers(scan.projectId);

      if (members.length === 0) {
        this.logger.log(
          `Project ${project.name} has no workspace members configured.`,
        );
        return;
      }

      const severityRank: Record<string, number> = {
        critical: 4,
        high: 3,
        medium: 2,
        low: 1,
      };

      for (const member of members) {
        const settings = await this.getSettings(member.userId);
        const userMinRank =
          severityRank[settings.minSeverity.toLowerCase()] || 3;

        // Filter findings matching severity settings
        const alertFindings = scan.findings.filter((f) => {
          const findRank = severityRank[f.severity.toLowerCase()] || 1;
          return findRank >= userMinRank;
        });

        // Trigger alert conditions: low score, blocking finding, or any severity findings matching user setting
        const overallScore = scan.overallScore ?? 100;
        const belowMinScore = overallScore < project.minimumScore;
        const hasBlocking = scan.findings.some((f) => f.blocking);

        const shouldAlert =
          alertFindings.length > 0 || belowMinScore || hasBlocking;

        if (!shouldAlert) {
          continue;
        }

        if (settings.emailAlerts) {
          const subject = `[SlopShield Alert] Code Quality Issues Detected: ${project.name} (${scan.statusResult?.toUpperCase()})`;
          let body = `Hello ${member.user.name},\n\n`;
          body += `SlopShield has completed scan #${scan.id.substring(0, 8)} on project "${project.name}".\n`;
          body += `=============================================================================\n`;
          body += `Scan Status: ${scan.statusResult?.toUpperCase() || "BLOCKED"}\n`;
          body += `Overall Score: ${overallScore}/100 (Minimum Required: ${project.minimumScore})\n`;
          body += `Total Vulnerabilities / Slop Findings: ${scan.findings.length}\n`;
          body += `=============================================================================\n\n`;

          if (belowMinScore) {
            body += `⚠️ WARNING: The overall project score has fallen below the configured minimum of ${project.minimumScore}.\n\n`;
          }

          if (alertFindings.length > 0) {
            body += `TOP FINDINGS IDENTIFIED (Severity >= ${settings.minSeverity.toUpperCase()}):\n`;
            alertFindings.slice(0, 5).forEach((f, idx) => {
              body += `${idx + 1}. [${f.severity.toUpperCase()}] ${f.title}\n`;
              body += `   File: ${f.filePath || "General"} : Line ${f.lineNumber || "N/A"}\n`;
              body += `   Details: ${f.description || "N/A"}\n`;
              body += `   Recommendation: ${f.recommendation || "N/A"}\n\n`;
            });
          }

          body += `View the complete interactive report here:\n`;
          body += `http://localhost:3000/scans/${scan.id}/report\n\n`;
          body += `Best regards,\nSlopShield Ingestion Engine`;

          await this.emailService.sendEmail(member.user.email, subject, body);
        }

        if (settings.larkAlerts) {
          this.logger.log(
            `Personal Lark Alert triggered for user ${member.user.name} (${member.user.larkUserId || "No Lark ID configured"})`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to process scan notifications: ${err.message}`);
    }
  }
}
