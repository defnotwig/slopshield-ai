import * as fs from "fs";
import * as path from "path";
import { Finding } from "@slopshield/shared";
import {
  StaticAnalyzer,
  AnalysisContext,
  AnalysisResult,
} from "../interfaces/static-analyzer.interface.js";

export class SecretAnalyzer implements StaticAnalyzer {
  public readonly name = "secret-scanner";
  public readonly description =
    "Detects hardcoded secrets, API keys, tokens, and passwords";

  private readonly patterns: { name: string; regex: RegExp }[] = [
    { name: "AWS Access Key", regex: /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/ },
    {
      name: "Generic API Key",
      regex:
        /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*['"]([a-zA-Z0-9_\-]{16,})['"]/i,
    },
    {
      name: "Generic Password",
      regex: /(?:password|passwd|pwd|secret)\s*[:=]\s*['"]([^'"]{8,})['"]/i,
    },
    {
      name: "Generic Token",
      regex: /(?:token|bearer|auth)\s*[:=]\s*['"]([a-zA-Z0-9_\-\.]{20,})['"]/i,
    },
    {
      name: "Connection String",
      regex: /(?:postgres|mysql|mongodb|redis):\/\/([^\s'"]+)/i,
    },
    {
      name: "Private Key",
      regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
    },
    {
      name: "JWT Token",
      regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/,
    },
    { name: "GitHub Token", regex: /gh[pousr]_[a-zA-Z0-9]{36,}/ },
    { name: "GitHub Fine-Grained Token", regex: /github_pat_[a-zA-Z0-9]{82}/ },
    { name: "Slack Token", regex: /xox[bpoas]-[a-zA-Z0-9-]+/ },
    {
      name: "Stripe API Key",
      regex:
        /rk_(?:live|test)_[0-9a-zA-Z]{24}|sk_(?:live|test)_[0-9a-zA-Z]{24}/,
    },
    {
      name: "Slack Webhook URL",
      regex:
        /https:\/\/hooks.slack.com\/services\/T[A-Za-z0-9_]{8}\/B[A-Za-z0-9_]{8}\/[A-Za-z0-9_]{24}/,
    },
    { name: "Google API Key", regex: /AIza[0-9A-Za-z-_]{35}/ },
    {
      name: "Heroku API Key",
      regex:
        /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
    },
    { name: "Facebook Access Token", regex: /EAACEdEose0cBA[0-9A-Za-z]+/ },
    {
      name: "Twitter OAuth Secret",
      regex: /[tT][wW][iI][tT][tT][eE][rR].*[0-9a-zA-Z]{35,44}/,
    },
    { name: "Mailgun API Key", regex: /key-[0-9a-zA-Z]{32}/ },
    { name: "Twilio Account SID", regex: /AC[a-f0-9]{32}/ },
    { name: "Twilio Auth Token", regex: /SK[a-f0-9]{32}/ },
  ];

  private readonly allowedExtensions = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".json",
    ".env",
    ".py",
    ".go",
    ".yaml",
    ".yml",
    ".toml",
    ".cfg",
    ".ini",
    ".conf",
    ".properties",
  ]);

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    const startTime = Date.now();
    const findings: Omit<Finding, "id" | "scanId">[] = [];

    try {
      for (const relativeFile of context.files) {
        const ext = path.extname(relativeFile).toLowerCase();
        const filename = path.basename(relativeFile).toLowerCase();

        // Skip files that are not textual or not source code/configs
        if (!this.allowedExtensions.has(ext) && !filename.startsWith(".env")) {
          continue;
        }

        const absolutePath = path.join(context.scanDir, relativeFile);
        if (!fs.existsSync(absolutePath)) {
          continue;
        }

        const stats = fs.statSync(absolutePath);
        if (!stats.isFile()) {
          continue;
        }

        const content = fs.readFileSync(absolutePath, "utf8");
        const lines = content.split(/\r?\n/);

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          const lineContent = lines[lineIndex];

          for (const pattern of this.patterns) {
            const match = lineContent.match(pattern.regex);
            if (match) {
              const fullMatch = match[0];
              const capturedValue = match[1] || fullMatch;

              // Avoid matching dummy/boilerplate values
              if (this.isBoilerplateValue(capturedValue)) {
                continue;
              }

              const redactedMatch = this.redactSecret(fullMatch, capturedValue);

              findings.push({
                severity: "critical",
                category: "backend-security",
                title: `Hardcoded Secret Detected (${pattern.name}): ${redactedMatch}`,
                file: relativeFile,
                line: lineIndex + 1,
                standardReferences: [
                  "CWE-798 Use of Hard-coded Credentials",
                  "OWASP A07:2021 Identification and Authentication Failures",
                ],
                whyItMatters:
                  "Hardcoding secrets or credentials directly in the codebase risks exposing them to unauthorised users, third-party hosting providers, or public repositories. Once leaked, credentials can be used to compromise databases, cloud platforms, and user data.",
                recommendation: `Remove the hardcoded credential from the source code. Move it to an environment variable (e.g. process.env or .env file) and load it dynamically at runtime. Ensure this secret has been revoked and rotated immediately.`,
                blocking: true,
                confidence: 0.95,
                source: "secret-scanner",
                codeSnippet: lineContent
                  .replace(fullMatch, redactedMatch)
                  .trim(),
              });
            }
          }
        }
      }

      return {
        analyzerName: this.name,
        success: true,
        findings,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        analyzerName: this.name,
        success: false,
        findings: [],
        error: err.message || String(err),
        durationMs: Date.now() - startTime,
      };
    }
  }

  private redactSecret(fullMatch: string, secretVal: string): string {
    if (secretVal.length <= 6) {
      return fullMatch.replace(secretVal, "******");
    }
    const visibleLength = Math.max(3, Math.floor(secretVal.length / 5));
    const start = secretVal.substring(0, visibleLength);
    const end = secretVal.substring(secretVal.length - visibleLength);
    const redactedVal = `${start}...***...${end}`;
    return fullMatch.replace(secretVal, redactedVal);
  }

  private isBoilerplateValue(val: string): boolean {
    const lower = val.toLowerCase().replace(/['"]/g, "").trim();
    const boilerplate = new Set([
      "dummy",
      "test",
      "temp",
      "placeholder",
      "your_api_key",
      "your-api-key",
      "mysecret",
      "password123",
      "admin123",
      "secret_key",
      "secret-key",
      "jwt_secret_key",
      "redis_password",
      "db_password",
      "postgresql://username:password@localhost:5432/db",
      "mongodb://username:password@localhost:27017/db",
      "mysql://username:password@localhost:3306/db",
    ]);
    return boilerplate.has(lower) || lower.length < 6;
  }
}
