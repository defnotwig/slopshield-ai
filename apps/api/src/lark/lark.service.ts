import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { LarkCardBuilder } from './card-builder.js';

@Injectable()
export class LarkService {
  private readonly logger = new Logger(LarkService.name);
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly webhookUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService
  ) {
    this.appId = this.configService.get<string>('LARK_APP_ID', '');
    this.appSecret = this.configService.get<string>('LARK_APP_SECRET', '');
    this.webhookUrl = this.configService.get<string>('LARK_WEBHOOK_URL', '');
  }

  public async sendScanCard(scanId: string, chatId?: string): Promise<boolean> {
    try {
      this.logger.log(`Assembling Lark notification card for scan ID: ${scanId}...`);

      const scan = await this.prisma.scanJob.findUnique({
        where: { id: scanId },
        include: {
          project: true,
          findings: {
            where: { falsePositive: false },
            orderBy: { severity: 'asc' },
            take: 5,
          },
        },
      });

      if (!scan) {
        this.logger.error(`Failed to send Lark card: Scan ${scanId} not found`);
        return false;
      }

      const topFindings = scan.findings.map((f) => ({
        title: f.title,
        severity: f.severity,
      }));

      const summaryPayload = {
        scanId: scan.id,
        repository: scan.sourceRef || scan.project?.name || 'Pasted Code',
        author: 'Developer',
        score: scan.overallScore || 0,
        status: (scan.statusResult as any) || 'blocked',
        topFindings,
        reportUrl: `http://localhost:3000/scans/${scan.id}/report`,
      };

      const cardJson =
        scan.statusResult === 'passed' || scan.statusResult === 'passed-with-warnings'
          ? LarkCardBuilder.buildPassedCard(summaryPayload)
          : LarkCardBuilder.buildBlockedCard(summaryPayload);

      // Store lark event logs in database
      await this.prisma.larkEvent.create({
        data: {
          scanJobId: scanId,
          eventType: 'card-sent',
          status: 'success',
          payload: cardJson,
        },
      });

      if (!this.webhookUrl) {
        this.logger.warn(`LARK_WEBHOOK_URL is not configured. Card JSON printed to console: ${JSON.stringify(cardJson, null, 2)}`);
        return true;
      }

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msg_type: 'interactive',
          card: cardJson,
        }),
      });

      if (!response.ok) {
        throw new Error(`Lark returned HTTP error status: ${response.status}`);
      }

      this.logger.log(`Successfully sent Lark card to webhook.`);
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to send Lark notification card: ${err.message}`);
      return false;
    }
  }

  public async createFixTask(findingId: string, assignTo?: string): Promise<any> {
    try {
      this.logger.log(`Creating Lark task for finding ID: ${findingId}...`);
      const finding = await this.prisma.finding.findUnique({
        where: { id: findingId },
      });

      if (!finding) {
        throw new Error(`Finding ${findingId} not found`);
      }

      // Check if task already exists
      const existingTask = await this.prisma.fixTask.findFirst({
        where: { findingId },
      });

      if (existingTask) {
        return existingTask;
      }

      // Create local database representation
      const fixTask = await this.prisma.fixTask.create({
        data: {
          findingId,
          assignedTo: assignTo || null,
          title: `Fix finding: ${finding.title}`,
          description: `Please resolve the following issue: ${finding.description || ''}\n\nFile: ${finding.filePath}\nLine: ${finding.lineNumber}\nRecommendation: ${finding.recommendation || ''}`,
          status: 'open',
          larkTaskId: `lark-task-mock-${Math.random().toString(36).substring(7)}`,
        },
      });

      this.logger.log(`Successfully created FixTask in database.`);
      return fixTask;
    } catch (err: any) {
      this.logger.error(`Failed to create Lark fix task: ${err.message}`);
      throw err;
    }
  }
}
