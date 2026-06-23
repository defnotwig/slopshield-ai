import { LarkScanSummary } from "@slopshield/shared";

export class LarkCardBuilder {
  /**
   * Constructs the Lark interactive card payload for scans that passed security standards.
   * Utilizes green styling cues, checkmark badges, and dynamic metadata fields.
   */
  public static buildPassedCard(summary: LarkScanSummary): any {
    const findingsList = summary.topFindings.map((f) => ({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `• **[${f.severity.toUpperCase()}]** ${f.title}`,
      },
    }));

    if (findingsList.length === 0) {
      findingsList.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: "• *No issues identified. Codebase clean!*",
        },
      });
    }

    return {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: "green",
        title: {
          tag: "plain_text",
          content: `🛡️ SlopShield Verified: Clean Code Ingested`,
        },
      },
      elements: [
        {
          tag: "div",
          fields: [
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**Repository / Source:**\n\`${summary.repository}\``,
              },
            },
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**Overall Score:**\n**\`${summary.score}/100\`** (Passed)`,
              },
            },
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**Ingestion ID:**\n\`#${summary.scanId.substring(0, 8)}\``,
              },
            },
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**Status:**\n🟩 **PASSED**`,
              },
            },
          ],
        },
        {
          tag: "hr",
        },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `**💡 Key Code Quality Observations:**`,
          },
        },
        ...findingsList,
        {
          tag: "hr",
        },
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: {
                tag: "plain_text",
                content: "View Full Report",
              },
              type: "primary",
              url: summary.reportUrl,
              value: {
                action: "view-report",
                scanId: summary.scanId,
              },
            },
          ],
        },
        {
          tag: "note",
          elements: [
            {
              tag: "plain_text",
              content:
                "🛡️ SlopShield AI Ingestion Engine • Continuous Verification Active",
            },
          ],
        },
      ],
    };
  }

  /**
   * Constructs the Lark interactive card payload for scans that failed security thresholds.
   * Utilizes red warning badges, alarm headers, and secondary fix actions.
   */
  public static buildBlockedCard(summary: LarkScanSummary): any {
    const findingsList = summary.topFindings.map((f) => ({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `• **[${f.severity.toUpperCase()}]** ${f.title}`,
      },
    }));

    return {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: "red",
        title: {
          tag: "plain_text",
          content: `🚨 SlopShield Alert: Blocker Identified`,
        },
      },
      elements: [
        {
          tag: "div",
          fields: [
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**Repository / Source:**\n\`${summary.repository}\``,
              },
            },
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**Overall Score:**\n**\`${summary.score}/100\`** (Blocked)`,
              },
            },
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**Ingestion ID:**\n\`#${summary.scanId.substring(0, 8)}\``,
              },
            },
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**Status:**\n🟥 **BLOCKED**`,
              },
            },
          ],
        },
        {
          tag: "hr",
        },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `**⚠️ Critical Blockers & AI Slop Detected:**`,
          },
        },
        ...findingsList,
        {
          tag: "hr",
        },
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: {
                tag: "plain_text",
                content: "View Full Report",
              },
              type: "danger",
              url: summary.reportUrl,
              value: {
                action: "view-report",
                scanId: summary.scanId,
              },
            },
            {
              tag: "button",
              text: {
                tag: "plain_text",
                content: "Create Fix Tasks",
              },
              type: "primary",
              value: {
                action: "create-tasks",
                scanId: summary.scanId,
              },
            },
          ],
        },
        {
          tag: "note",
          elements: [
            {
              tag: "plain_text",
              content:
                "🛡️ SlopShield AI Ingestion Engine • Continuous Verification Active",
            },
          ],
        },
      ],
    };
  }
}
