export type ApiMode = "mock" | "live";

export interface AppConfig {
  readonly apiMode: ApiMode;
  readonly isMock: boolean;
  readonly apiUrl: string;
  readonly appName: string;
  /**
   * True only when mock data is being served in a production environment via
   * an explicit opt-in. Drives the visible "mock data in use" indicator.
   */
  readonly showMockIndicator: boolean;
}

function resolveMode(raw: string | undefined): ApiMode {
  // Anything that isn't explicitly "live" falls back to the safe default.
  return raw?.trim().toLowerCase() === "live" ? "live" : "mock";
}

function isProductionEnv(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === "production";
}

/**
 * `ALLOW_MOCK_IN_PRODUCTION` is treated as an explicit opt-in only when it
 * carries an affirmative value. A missing, empty, or falsy value is NOT an
 * opt-in, so mock data can never leak into production by accident.
 */
function isMockAllowedInProduction(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

/**
 * Resolve whether mock data is actually served, and whether the production
 * mock indicator should show.
 *
 * - Live mode always uses real data; mock can never be re-enabled (Req 2.1, 2.2a).
 * - Mock mode in production is refused unless explicitly opted in (Req 2.4),
 *   and when permitted exposes a visible indicator (Req 2.5).
 * - Mock mode outside production is the normal local demo path (Req 2.3).
 */
function resolveMockState(
  mode: ApiMode,
  isProduction: boolean,
  mockOptIn: boolean,
): { isMock: boolean; showMockIndicator: boolean } {
  if (mode === "live") {
    return { isMock: false, showMockIndicator: false };
  }
  if (isProduction) {
    return mockOptIn
      ? { isMock: true, showMockIndicator: true }
      : { isMock: false, showMockIndicator: false };
  }
  return { isMock: true, showMockIndicator: false };
}

const apiMode = resolveMode(process.env.NEXT_PUBLIC_API_MODE);
const isProduction = isProductionEnv(process.env.NODE_ENV);
const mockOptIn = isMockAllowedInProduction(process.env.ALLOW_MOCK_IN_PRODUCTION);
const { isMock, showMockIndicator } = resolveMockState(
  apiMode,
  isProduction,
  mockOptIn,
);

export const config: AppConfig = {
  apiMode,
  isMock,
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? "").trim(),
  appName: (process.env.NEXT_PUBLIC_APP_NAME ?? "SlopShield AI").trim(),
  showMockIndicator,
};

/**
 * Guard called by the API client before any live request.
 * Never invoked in mock mode, so it cannot break the demo build.
 */
export function assertLiveConfig(c: AppConfig = config): void {
  if (c.apiMode === "live" && c.apiUrl.length === 0) {
    throw new Error(
      "[config] API_MODE=live but NEXT_PUBLIC_API_URL is not set. " +
        "Set NEXT_PUBLIC_API_URL to the deployed API base URL, or use API_MODE=mock.",
    );
  }
}
