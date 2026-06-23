/**
 * Configuration for the GitHub repository ingestion path.
 *
 * These values bound how much untrusted external repository data the API will
 * fetch and extract, and which mechanism is used to fetch it. They are read
 * from the process environment with safe defaults (see {@link loadGitHubIngestionConfig}).
 */
export interface GitHubIngestionConfig {
  /** Maximum total bytes to accept while streaming a repository tarball (MAX_REPO_BYTES). */
  maxRepoBytes: number;
  /** Maximum number of files to extract into the scan directory (MAX_FILE_COUNT). */
  maxFileCount: number;
  /** Maximum time, in milliseconds, allowed for the fetch operation (FETCH_TIMEOUT_MS). */
  fetchTimeoutMs: number;
  /** Optional GitHub access token for higher rate limits / private repos (GITHUB_TOKEN). */
  githubToken?: string;
  /** Mechanism used to fetch the repository. Only "tarball" is supported in v1. */
  fetchMechanism: "tarball";
}

/** Default maximum repository size in bytes (250 MB). */
const DEFAULT_MAX_REPO_BYTES = 262_144_000;
/** Minimum permitted maximum repository size in bytes (1 MB). */
const MIN_MAX_REPO_BYTES = 1_048_576;

/**
 * Parse the MAX_REPO_BYTES env value into a validated byte cap.
 *
 * Falls back to {@link DEFAULT_MAX_REPO_BYTES} when the value is missing,
 * not an integer, or below {@link MIN_MAX_REPO_BYTES}.
 */
export function parseMaxRepoBytes(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_REPO_BYTES;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_MAX_REPO_BYTES) {
    return DEFAULT_MAX_REPO_BYTES;
  }
  return value;
}

/**
 * Load the GitHub ingestion configuration from the environment.
 *
 * Defaults:
 *  - MAX_REPO_BYTES  = 100 MB (100 * 1024 * 1024)
 *  - MAX_FILE_COUNT  = 5000
 *  - FETCH_TIMEOUT_MS = 60000 (60 s)
 *  - GITHUB_TOKEN    = undefined (anonymous access)
 *  - fetchMechanism  = "tarball"
 *
 * An empty GITHUB_TOKEN env value is treated as "not configured" (undefined).
 */
export function loadGitHubIngestionConfig(
  env: NodeJS.ProcessEnv = process.env,
): GitHubIngestionConfig {
  return {
    maxRepoBytes: parseMaxRepoBytes(env.MAX_REPO_BYTES),
    maxFileCount: Number(env.MAX_FILE_COUNT ?? 5000), // 5000 files
    fetchTimeoutMs: Number(env.FETCH_TIMEOUT_MS ?? 60_000), // 60 s
    githubToken: env.GITHUB_TOKEN || undefined,
    fetchMechanism: "tarball",
  };
}
