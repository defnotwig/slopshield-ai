import { ScannerOrchestrator } from "./scanner.orchestrator.js";

/**
 * Unit test for the analyzer suite registered by ScannerOrchestrator.
 *
 * The processor runs the full deterministic analyzer suite (Gemini AI review is
 * gated separately in the processor). This asserts the orchestrator registers
 * the expected static analyzers on module init: secret scan, ESLint, TypeScript
 * diagnostics, Semgrep, and the basic/slop rules analyzer.
 *
 * Validates: Requirements 8.1
 */
describe("ScannerOrchestrator analyzer suite registration", () => {
  it("registers the expected static analyzer suite on module init", async () => {
    const orchestrator = new ScannerOrchestrator();

    await orchestrator.onModuleInit();

    // The registered analyzers live on the private `analyzers` field.
    const registered: { name: string }[] = (orchestrator as any).analyzers;
    const names = registered.map((a) => a.name);

    // Order-independent: assert the suite contains exactly these analyzers.
    expect(names.slice().sort()).toEqual(
      [
        "secret-scanner",
        "eslint",
        "typescript-compiler",
        "semgrep",
        "slop-scanner",
      ].sort(),
    );
  });

  it("registers exactly five analyzers", async () => {
    const orchestrator = new ScannerOrchestrator();

    await orchestrator.onModuleInit();

    expect((orchestrator as any).analyzers).toHaveLength(5);
  });
});
