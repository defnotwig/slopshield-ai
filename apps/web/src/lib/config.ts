export type ApiMode = "mock" | "live";

export interface AppConfig {
  readonly apiMode: ApiMode;
  readonly isMock: boolean;
  readonly apiUrl: string;
  readonly appName: string;
}

function resolveMode(raw: string | undefined): ApiMode {
  // Anything that isn't explicitly "live" falls back to the safe default.
  return raw?.trim().toLowerCase() === "live" ? "live" : "mock";
}

const apiMode = resolveMode(process.env.NEXT_PUBLIC_API_MODE);

export const config: AppConfig = {
  apiMode,
  isMock: apiMode === "mock",
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? "").trim(),
  appName: (process.env.NEXT_PUBLIC_APP_NAME ?? "SlopShield AI").trim(),
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
