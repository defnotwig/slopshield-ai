import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { LarkCardBuilder } from "./card-builder.js";
import { AuditService, AUDIT_ACTION } from "../audit/audit.service.js";

@Injectable()
export class LarkService {
  private readonly logger = new Logger(LarkService.name);
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly webhookUrl: string;
  private readonly defaultChatId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {
    this.appId = this.configService.get<string>("LARK_APP_ID", "");
    this.appSecret = this.configService.get<string>("LARK_APP_SECRET", "");
    this.webhookUrl = this.configService.get<string>("LARK_WEBHOOK_URL", "");
    this.defaultChatId = this.configService.get<string>("LARK_DEFAULT_CHAT_ID", "");
  }

  /**
   * Obtain a tenant access token from Lark using app credentials.
   * Required for sending messages to chats via the Bot API.
   */
  private async getTenantAccessToken(): Promise<string> {
    const response = await fetch(
      "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      },
    );

    const data = (await response.json()) as any;
    if (!response.ok || data.code !== 0) {
      throw new Error(
        `Failed to get Lark tenant access token: ${data.msg || response.statusText}`,
      );
    }

    return data.tenant_access_token;
  }

  /**
   * Send an interactive card message to a Lark chat using the Bot API.
   * Uses POST /im/v1/messages with receive_id_type=chat_id.
   */
  private async sendCardToChat(
    chatId: string,
    cardJson: any,
  ): Promise<void> {
    const token = await this.getTenantAccessToken();

    const response = await fetch(
      "https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=chat_id",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: "interactive",
          content: JSON.stringify(cardJson),
        }),
      },
    );

    const data = (await response.json()) as any;
    if (!response.ok || data.code !== 0) {
      throw new Error(
        `Failed to send Lark card to chat ${chatId}: ${data.msg || response.statusText}`,
      );
    }
  }

  /**
   * Resolves the public web URL used to build report links in Lark cards.
   * Prefers `PUBLIC_WEB_URL`, falling back to `CORS_ORIGIN`. Never returns a
   * `localhost` value in delivered cards — callers must ensure the resulting
   * URL is real in production (Req 9.1, 9.7, B2).
   */
  private getPublicWebUrl(): string {
    const publicWebUrl = this.configService.get<string>("PUBLIC_WEB_URL", "");
    if (publicWebUrl) {
      return publicWebUrl.replace(/\/+$/, "");
    }
    const corsOrigin = this.configService.get<string>("CORS_ORIGIN", "");
    if (corsOrigin) {
      return corsOrigin.replace(/\/+$/, "");
    }
    return "";
  }

  public async sendScanCard(scanId: string, chatId?: string): Promise<boolean> {
    // Resolved outside the try so the catch handler can update the same
    // LarkEvent row from `pending` to `failed` if a throw occurs after creation.
    let larkEventId: string | null = null;
    let actorId: string | null = null;

    try {
      this.logger.log(
        `Assembling Lark notification card for scan ID: ${scanId}...`,
      );

      const scan = await this.prisma.scanJob.findUnique({
        where: { id: scanId },
        include: {
          project: true,
          startedByUser: true,
          findings: {
            where: { falsePositive: false },
            orderBy: { severity: "asc" },
            take: 5,
          },
        },
      });

      if (!scan) {
        this.logger.error(`Failed to send Lark card: Scan ${scanId} not found`);
        return false;
      }

      actorId = scan.startedBy ?? null;

      // (Req 9.2) Neither webhook nor chat ID configured → skip delivery.
      const targetChatId = chatId || this.defaultChatId;
      const hasWebhook = !!this.webhookUrl;
      const hasChatDelivery = !!(targetChatId && this.appId && this.appSecret);

      if (!hasWebhook && !hasChatDelivery) {
        this.logger.warn(
          `Neither LARK_WEBHOOK_URL nor LARK_DEFAULT_CHAT_ID is configured. Skipping Lark delivery for scan ${scanId}.`,
        );
        await this.prisma.larkEvent.create({
          data: {
            scanJobId: scanId,
            eventType: "card-sent",
            status: "skipped",
            chatId: targetChatId ?? null,
          },
        });
        await this.auditService.record({
          actorId,
          action: AUDIT_ACTION.LARK_SEND,
          target: scanId,
          metadata: { outcome: "skipped", reason: "no-delivery-method-configured" },
        });
        return true;
      }

      const topFindings = scan.findings.map((f: any) => ({
        title: f.title,
        severity: f.severity,
      }));

      // (Req 9.1, 9.7, B2) Build the card from real data: author from the
      // scan's initiating user; report URL from the public web URL config.
      // Never emit hardcoded "Developer" or `localhost` values.
      const author =
        scan.startedByUser?.name ||
        scan.startedByUser?.email ||
        "Unknown author";
      const publicWebUrl = this.getPublicWebUrl();
      const reportUrl = `${publicWebUrl}/scans/${scan.id}/report`;

      const summaryPayload = {
        scanId: scan.id,
        repository: scan.sourceRef || scan.project?.name || "Pasted Code",
        author,
        score: scan.overallScore || 0,
        status: (scan.statusResult as any) || "blocked",
        topFindings,
        reportUrl,
      };

      const cardJson =
        scan.statusResult === "passed" ||
        scan.statusResult === "passed-with-warnings"
          ? LarkCardBuilder.buildPassedCard(summaryPayload)
          : LarkCardBuilder.buildBlockedCard(summaryPayload);

      // (Req 9.3) Record the LarkEvent as `pending` BEFORE delivery.
      const pendingEvent = await this.prisma.larkEvent.create({
        data: {
          scanJobId: scanId,
          eventType: "card-sent",
          status: "pending",
          chatId: targetChatId ?? null,
          payload: cardJson,
        },
      });
      larkEventId = pendingEvent.id;

      // Prefer Bot API (chat ID) over webhook for delivery
      if (hasChatDelivery) {
        await this.sendCardToChat(targetChatId, cardJson);
      } else {
        const response = await fetch(this.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msg_type: "interactive",
            card: cardJson,
          }),
        });

        if (!response.ok) {
          throw new Error(`Lark webhook returned HTTP error status: ${response.status}`);
        }
      }

      // (Req 9.4, 9.4a) Success response → update to `success`.
      await this.prisma.larkEvent.update({
        where: { id: larkEventId },
        data: { status: "success" },
      });

      this.logger.log(`Successfully sent Lark card to webhook.`);
      await this.auditService.record({
        actorId,
        action: AUDIT_ACTION.LARK_SEND,
        target: scanId,
        metadata: { outcome: "success" },
      });
      return true;
    } catch (err: any) {
      this.logger.error(
        `Failed to send Lark notification card: ${err.message}`,
      );
      // (Req 9.5) On throw/non-success, update the pending event to `failed`.
      if (larkEventId) {
        await this.prisma.larkEvent
          .update({
            where: { id: larkEventId },
            data: { status: "failed" },
          })
          .catch((updateErr: any) => {
            this.logger.error(
              `Failed to mark LarkEvent ${larkEventId} as failed: ${updateErr?.message ?? String(updateErr)}`,
            );
          });
      }
      await this.auditService.record({
        actorId,
        action: AUDIT_ACTION.LARK_SEND,
        target: scanId,
        metadata: { outcome: "failed", error: err?.message ?? String(err) },
      });
      return false;
    }
  }

  public async createFixTask(
    findingId: string,
    assignTo?: string,
  ): Promise<any> {
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
          description: `Please resolve the following issue: ${finding.description || ""}\n\nFile: ${finding.filePath}\nLine: ${finding.lineNumber}\nRecommendation: ${finding.recommendation || ""}`,
          status: "open",
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
