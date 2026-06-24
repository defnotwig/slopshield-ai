/**
 * Pure scanMode policy: maps the user-selected scan profile to which analyzers
 * run, whether the AI pass runs, and which files are in scope. Kept dependency
 * free so it can be exercised by unit/property tests.
 *
 * Modes:
 *  - full          → all analyzers + AI review (default)
 *  - fast          → all static analyzers, no AI review
 *  - security-only → security/supply-chain analyzers (+ AI)
 *  - frontend-only → frontend-relevant analyzers, scoped to frontend files (+ AI)
 *  - backend-only  → backend-relevant analyzers, scoped to backend files (+ AI)
 */
export type ScanMode =
  | "full"
  | "fast"
  | "security-only"
  | "frontend-only"
  | "backend-only";

const SECURITY_ANALYZERS = [
  "secret-scanner",
  "semgrep",
  "dependency-scanner",
  "eslint",
  "custom-rules",
];

const FRONTEND_ANALYZERS = [
  "eslint",
  "typescript-compiler",
  "slop-scanner",
  "a11y-scanner",
  "secret-scanner",
  "custom-rules",
];

const BACKEND_ANALYZERS = [
  "secret-scanner",
  "typescript-compiler",
  "semgrep",
  "architecture-scanner",
  "dependency-scanner",
  "slop-scanner",
  "custom-rules",
];

/**
 * The analyzer-name allowlist for a mode, or `null` to run every registered
 * analyzer. `fast` returns null (all static analyzers) and relies on
 * `shouldRunAiForMode` to skip the AI pass.
 */
export function analyzersForMode(mode: string): string[] | null {
  switch (mode) {
    case "security-only":
      return SECURITY_ANALYZERS;
    case "frontend-only":
      return FRONTEND_ANALYZERS;
    case "backend-only":
      return BACKEND_ANALYZERS;
    case "fast":
    case "full":
    default:
      return null;
  }
}

/** Whether the (expensive) AI review pass should run for this mode. */
export function shouldRunAiForMode(mode: string): boolean {
  return mode !== "fast";
}

/** Whether a classified file is in scope for this mode. */
export function fileMatchesMode(
  mode: string,
  file: { isFrontend: boolean; isBackend: boolean },
): boolean {
  if (mode === "frontend-only") {
    return file.isFrontend;
  }
  if (mode === "backend-only") {
    return file.isBackend;
  }
  return true;
}
