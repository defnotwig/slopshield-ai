import { LarkScanSummary } from '@slopshield/shared';

export class LarkCardBuilder {
  public static buildPassedCard(summary: LarkScanSummary): any {
    const findingsList = summary.topFindings.map((f) => ({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `• **[${f.severity.toUpperCase()}]** ${f.title}`,
      },
    }));

    return {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: 'green',
        title: {
          tag: 'plain_text',
          content: `🛡️ SlopShield Passed: ${summary.repository}`,
        },
      },
      elements: [
        {
          tag: 'markdown',
          content: `**Scan ID:** ${summary.scanId}\n**Author:** ${summary.author}\n**Overall Score:** **${summary.score}/100** (Passed)`,
        },
        {
          tag: 'hr',
        },
        {
          tag: 'markdown',
          content: `**Top Quality Observations:**`,
        },
        ...findingsList,
        {
          tag: 'hr',
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: 'View Full Report',
              },
              type: 'primary',
              value: {
                action: 'view-report',
                scanId: summary.scanId,
              },
            },
          ],
        },
      ],
    };
  }

  public static buildBlockedCard(summary: LarkScanSummary): any {
    const findingsList = summary.topFindings.map((f) => ({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `• **[${f.severity.toUpperCase()}]** ${f.title}`,
      },
    }));

    return {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: 'red',
        title: {
          tag: 'plain_text',
          content: `🚨 SlopShield Blocked: ${summary.repository}`,
        },
      },
      elements: [
        {
          tag: 'markdown',
          content: `**Scan ID:** ${summary.scanId}\n**Author:** ${summary.author}\n**Overall Score:** **${summary.score}/100** (Blocked)`,
        },
        {
          tag: 'hr',
        },
        {
          tag: 'markdown',
          content: `**Critical Blockers Identified:**`,
        },
        ...findingsList,
        {
          tag: 'hr',
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: 'View Full Report',
              },
              type: 'danger',
              value: {
                action: 'view-report',
                scanId: summary.scanId,
              },
            },
            {
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: 'Create Fix Tasks',
              },
              type: 'primary',
              value: {
                action: 'create-tasks',
                scanId: summary.scanId,
              },
            },
          ],
        },
      ],
    };
  }
}
