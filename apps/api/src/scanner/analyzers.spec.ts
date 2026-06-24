// Integration tests for the new/expanded static analyzers, exercised against
// real temp fixtures on disk (the analyzers read files directly).

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  SlopAnalyzer,
  ArchitectureAnalyzer,
  DependencyAnalyzer,
  A11yAnalyzer,
  CustomRuleAnalyzer,
} from "@slopshield/scanner-plugins";

let scanDir: string;

function write(rel: string, content: string): string {
  const abs = path.join(scanDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return rel;
}

beforeAll(() => {
  scanDir = fs.mkdtempSync(path.join(os.tmpdir(), "slopshield-analyzers-"));
});

afterAll(() => {
  fs.rmSync(scanDir, { recursive: true, force: true });
});

describe("SlopAnalyzer (expanded rules)", () => {
  it("flags not-implemented stubs, eval, and empty catch blocks", async () => {
    const file = write(
      "src/slop.ts",
      [
        "export function todo() {",
        "  throw new Error('Not implemented');",
        "}",
        "function danger(x: string) { return eval(x); }",
        "try { doThing(); } catch (e) {}",
      ].join("\n"),
    );
    const result = await new SlopAnalyzer().analyze({
      scanDir,
      files: [file],
      scanId: "t",
    });
    expect(result.success).toBe(true);
    const titles = result.findings.map((f) => f.title);
    expect(titles.some((t) => t.includes("Not-Implemented Stub"))).toBe(true);
    expect(titles.some((t) => t.includes("Dynamic Code Execution"))).toBe(true);
    expect(titles.some((t) => t.includes("Empty Catch Block"))).toBe(true);
  });
});

describe("ArchitectureAnalyzer", () => {
  it("detects a circular import between two modules", async () => {
    const a = write("cyc/a.ts", "import { b } from './b';\nexport const a = () => b();\n");
    const b = write("cyc/b.ts", "import { a } from './a';\nexport const b = () => a();\n");
    const result = await new ArchitectureAnalyzer().analyze({
      scanDir,
      files: [a, b],
      scanId: "t",
    });
    expect(result.success).toBe(true);
    expect(
      result.findings.some((f) => f.title === "Circular Import"),
    ).toBe(true);
  });

  it("flags a god file over the line threshold", async () => {
    const big = write(
      "big/huge.ts",
      Array.from({ length: 520 }, (_, i) => `const v${i} = ${i};`).join("\n"),
    );
    const result = await new ArchitectureAnalyzer().analyze({
      scanDir,
      files: [big],
      scanId: "t",
    });
    expect(result.findings.some((f) => f.title === "God File")).toBe(true);
  });
});

describe("DependencyAnalyzer", () => {
  it("flags a known-vulnerable dependency and a typosquat", async () => {
    const pkg = write(
      "package.json",
      JSON.stringify({
        name: "fixture",
        dependencies: { lodash: "4.17.10", reactt: "^18.0.0" },
      }),
    );
    const result = await new DependencyAnalyzer().analyze({
      scanDir,
      files: [pkg],
      scanId: "t",
    });
    expect(result.success).toBe(true);
    expect(
      result.findings.some((f) => f.title.includes("Vulnerable Dependency: lodash")),
    ).toBe(true);
    expect(
      result.findings.some((f) => f.title.includes("Possible Typosquat: reactt")),
    ).toBe(true);
  });
});

describe("A11yAnalyzer", () => {
  it("flags an <img> without alt", async () => {
    const cmp = write(
      "ui/Avatar.tsx",
      "export const Avatar = () => <img src=\"/a.png\" />;\n",
    );
    const result = await new A11yAnalyzer().analyze({
      scanDir,
      files: [cmp],
      scanId: "t",
    });
    expect(
      result.findings.some((f) => f.title === "Image Missing Alt Text"),
    ).toBe(true);
  });
});

describe("CustomRuleAnalyzer", () => {
  it("applies an enabled project rule and skips when none configured", async () => {
    const file = write("svc/handler.ts", "const password = 'hunter2';\n");

    const withRules = await new CustomRuleAnalyzer().analyze({
      scanDir,
      files: [file],
      scanId: "t",
      customRules: [
        {
          id: "r1",
          name: "No inline password",
          pattern: "password\\s*=",
          severity: "high",
          category: "backend-security",
          message: "Inline password literal.",
          enabled: true,
        },
      ],
    });
    expect(withRules.findings.some((f) => f.title.includes("No inline password"))).toBe(true);

    const noRules = await new CustomRuleAnalyzer().analyze({
      scanDir,
      files: [file],
      scanId: "t",
    });
    expect(noRules.skipped).toBe(true);
    expect(noRules.findings.length).toBe(0);
  });
});
