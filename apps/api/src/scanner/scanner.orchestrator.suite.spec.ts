import { ScannerOrchestrator } from "./scanner.orchestrator.js";

/**
 * Unit test for the analyzer suite registered by ScannerOrchestrator.
 *
 * The processor runs the full deterministic analyzer suite (Gemini AI review is
 * gated separately in the processor). This asserts the orchestrator registers
 * the expected static analyzers on module init: secret scan, ESLint, TypeScript
 * diagnostics, Semgrep, the slop rules analyzer, plus the architecture,
 * dependency-vulnerability, accessibility, and per-project custom-rule analyzers.
 *
 * Validates: Requirements 8.1
 */
const EXPECTED_ANALYZERS = [
  "secret-scanner",
  "eslint",
  "typescript-compiler",
  "semgrep",
  "slop-scanner",
  "architecture-scanner",
  "dependency-scanner",
  "a11y-scanner",
  "custom-rules",
];

describe("ScannerOrchestrator analyzer suite registration", () => {
  it("registers the expected static analyzer suite on module init", async () => {
    const orchestrator = new ScannerOrchestrator();

    await orchestrator.onModuleInit();

    // The registered analyzers live on the private `analyzers` field.
    const registered: { name: string }[] = (orchestrator as any).analyzers;
    const names = registered.map((a) => a.name);

    // Order-independent: assert the suite contains exactly these analyzers.
    expect(names.slice().sort()).toEqual(EXPECTED_ANALYZERS.slice().sort());
  });

  it("registers the full analyzer suite", async () => {
    const orchestrator = new ScannerOrchestrator();

    await orchestrator.onModuleInit();

    expect((orchestrator as any).analyzers).toHaveLength(
      EXPECTED_ANALYZERS.length,
    );
  });
});
