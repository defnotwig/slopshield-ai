import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly logFilePath: string;

  constructor() {
    const tempDir = path.join(process.cwd(), "temp-scans");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    this.logFilePath = path.join(tempDir, "emails.log");
  }

  /**
   * Simulates sending a high-fidelity email report by logging to a local file.
   */
  public async sendEmail(
    to: string,
    subject: string,
    body: string,
  ): Promise<boolean> {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = `
=============================================================================
TIMESTAMP: ${timestamp}
TO: ${to}
SUBJECT: ${subject}
=============================================================================
${body}
=============================================================================
\n`;

      fs.appendFileSync(this.logFilePath, logEntry, "utf8");
      this.logger.log(
        `Mock email sent to ${to}. Appended to: ${this.logFilePath}`,
      );
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to output mock email alert: ${err.message}`);
      return false;
    }
  }
}
