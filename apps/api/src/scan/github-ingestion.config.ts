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
    maxRepoBytes: Number(env.MAX_REPO_BYTES ?? 100 * 1024 * 1024), // 100 MB
    maxFileCount: Number(env.MAX_FILE_COUNT ?? 5000), // 5000 files
    fetchTimeoutMs: Number(env.FETCH_TIMEOUT_MS ?? 60_000), // 60 s
    githubToken: env.GITHUB_TOKEN || undefined,
    fetchMechanism: "tarball",
  };
}
