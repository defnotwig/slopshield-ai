import * as fs from "fs";
import * as path from "path";
import { Finding, FindingSeverity } from "@slopshield/shared";
import {
  StaticAnalyzer,
  AnalysisContext,
  AnalysisResult,
} from "../interfaces/static-analyzer.interface.js";

type A11yFinding = Omit<Finding, "id" | "scanId">;

const JSX_EXTS = new Set([".tsx", ".jsx"]);

/**
 * Accessibility analyzer for React/JSX. Catches the high-frequency WCAG misses
 * that AI-generated UI code routinely ships: images without alt text, buttons
 * with no accessible name, click handlers on non-interactive elements without
 * keyboard support, and anchors without an href.
 */
export class A11yAnalyzer implements StaticAnalyzer {
  public readonly name = "a11y-scanner";
  public readonly description =
    "Detects common WCAG accessibility issues in React/JSX components";

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    const startTime = Date.now();
    const findings: A11yFinding[] = [];

    try {
      for (const file of context.files) {
        if (!JSX_EXTS.has(path.extname(file).toLowerCase())) {
          continue;
        }
        const abs = path.join(context.scanDir, file);
        let content: string;
        try {
          content = await fs.promises.readFile(abs, "utf8");
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          this.scanLine(file, lines[i], i + 1, findings);
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

  private scanLine(
    file: string,
    line: string,
    lineNo: number,
    findings: A11yFinding[],
  ): void {
    // 1. <img> without alt
    for (const tag of line.matchAll(/<img\b[^>]*>/gi)) {
      if (!/\balt\s*=/.test(tag[0])) {
        findings.push(
          this.finding(
            "Image Missing Alt Text",
            "medium",
            file,
            lineNo,
            "WCAG_22",
            "An <img> without an alt attribute is invisible to screen readers (WCAG 1.1.1). Decorative images still need alt=\"\".",
            'Add a descriptive alt attribute, or alt="" if the image is purely decorative.',
            tag[0],
          ),
        );
      }
    }

    // 2. <button> with no accessible name (empty or self-closing, no aria-label/title)
    for (const tag of line.matchAll(/<button\b[^>]*(?:\/>|>\s*<\/button>)/gi)) {
      if (!/(?:aria-label|aria-labelledby|title)\s*=/.test(tag[0])) {
        findings.push(
          this.finding(
            "Button Without Accessible Name",
            "medium",
            file,
            lineNo,
            "WCAG_22",
            "A button with no text content and no aria-label has no accessible name (WCAG 4.1.2); screen-reader users hear only \"button\".",
            "Add visible text content or an aria-label describing the action.",
            tag[0],
          ),
        );
      }
    }

    // 3. onClick on a non-interactive element without keyboard support
    for (const tag of line.matchAll(/<(div|span)\b[^>]*\bonClick=[^>]*>/gi)) {
      const hasKeyHandler = /\bon(?:KeyDown|KeyUp|KeyPress)\s*=/.test(tag[0]);
      const hasRole = /\brole\s*=/.test(tag[0]);
      if (!hasKeyHandler || !hasRole) {
        findings.push(
          this.finding(
            "Click Handler on Non-Interactive Element",
            "medium",
            file,
            lineNo,
            "WCAG_22",
            `A <${tag[1]}> has onClick but ${!hasRole ? "no role" : "no keyboard handler"}; keyboard users cannot activate it (WCAG 2.1.1).`,
            "Use a <button>, or add role=\"button\", tabIndex, and an onKeyDown handler.",
            tag[0],
          ),
        );
      }
    }

    // 4. <a> without href (not focusable / not a real link)
    for (const tag of line.matchAll(/<a\b[^>]*>/gi)) {
      if (!/\bhref\s*=/.test(tag[0])) {
        findings.push(
          this.finding(
            "Anchor Without href",
            "low",
            file,
            lineNo,
            "WCAG_22",
            "An <a> without href is not keyboard-focusable and is not announced as a link (WCAG 2.1.1 / 4.1.2).",
            "Add a valid href, or use a <button> if it triggers an action.",
            tag[0],
          ),
        );
      }
    }
  }

  private finding(
    title: string,
    severity: FindingSeverity,
    file: string,
    line: number,
    standard: string,
    whyItMatters: string,
    recommendation: string,
    snippet: string,
  ): A11yFinding {
    return {
      severity,
      category: "accessibility",
      title,
      file,
      line,
      standardReferences: [standard],
      whyItMatters,
      recommendation,
      blocking: false,
      confidence: 0.75,
      source: "accessibility",
      codeSnippet: snippet.trim().slice(0, 240),
    };
  }
}
