import { Injectable, Logger, Optional } from "@nestjs/common";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import * as path from "node:path";
import * as fs from "node:fs";
import type { Stats } from "node:fs";
import * as tar from "tar";
import {
  GitHubIngestionConfig,
  loadGitHubIngestionConfig,
} from "./github-ingestion.config.js";

/** Parsed components of a validated GitHub repository URL. */
export interface ParsedRepo {
  owner: string;
  repo: string;
  /** Optional ref from the URL path (/tree/<ref>) or the explicit ref argument. */
  ref?: string;
}

/** Result of a successful ingestion into the scan directory. */
export interface IngestionResult {
  scanDir: string;
  fileCount: number;
  totalBytes: number;
}

/** Discriminated failure reasons, mapped to HTTP status / scan failure reason. */
export type IngestionErrorKind =
  | "invalid-url" // 400 — syntactically invalid or disallowed scheme/host
  | "not-a-repo-url" // 400 — owner/repo could not be extracted
  | "invalid-ref" // 400 — ref contains illegal characters
  | "not-found" // 404 — repo or ref does not exist / not accessible
  | "private-no-token" // 401/403 — private repo with no configured token
  | "too-large" // fetch aborted: exceeded MAX_REPO_BYTES
  | "too-many-files" // extraction aborted: exceeded MAX_FILE_COUNT
  | "timeout" // fetch exceeded FETCH_TIMEOUT_MS
  | "network-error"; // transient transport error

/**
 * Error carrying a discriminated {@link IngestionErrorKind} and a `transient`
 * flag distinguishing transient transport errors from invalid-input errors
 * (Requirement 11.7).
 */
export class GitHubIngestionError extends Error {
  constructor(
    public readonly kind: IngestionErrorKind,
    message: string,
    public readonly transient = false,
  ) {
    super(message);
    this.name = "GitHubIngestionError";
  }
}

// Only these are accepted. Everything else is a 400.
const ALLOWED_PROTOCOL = "https:";
const ALLOWED_HOST = "github.com";

/** GitHub owner/repo allowed name characters. */
const NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Conservative git ref-name allowlist consistent with git-check-ref-format.
 * Allows letters, digits, `_ - . /`; the additional `validateRef` checks reject
 * whitespace, `~ ^ : ? * [ \`, `..`, `@{`, leading `-`/`/`, trailing `/` or `.lock`.
 */
const REF_ALLOWED = /^[A-Za-z0-9._/-]+$/;

@Injectable()
export class GitHubIngestionService {
  private readonly logger = new Logger(GitHubIngestionService.name);
  private readonly config: GitHubIngestionConfig;

  /** Directory names excluded anywhere in an entry path (Req 3.7). */
  private readonly EXCLUDED_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "out",
    ".next",
    ".turbo",
    "coverage",
    ".cache",
    "vendor",
    "__pycache__",
    ".venv",
  ]);

  /** Binary file extensions excluded from extraction (Req 3.8). */
  private readonly BINARY_EXT = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".class",
    ".jar",
    ".wasm",
    ".mp4",
    ".mp3",
    ".mov",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".bin",
  ]);

  // `GitHubIngestionConfig` is a plain type, not a Nest provider. Mark the
  // parameter @Optional() so Nest injects `undefined` (rather than trying to
  // resolve an unregistered "Object" token and crashing at startup); the
  // constructor then falls back to loading config from the environment.
  constructor(@Optional() config?: GitHubIngestionConfig) {
    this.config = config ?? loadGitHubIngestionConfig();
  }

  /**
   * Validate scheme + host allowlist (https + github.com only).
   * Throws GitHubIngestionError('invalid-url' | 'not-a-repo-url').
   * Returns parsed owner/repo (+ ref if present in the URL path).
   */
  public validateUrl(rawUrl: string): ParsedRepo {
    let url: URL;
    try {
      url = new URL(rawUrl.trim());
    } catch {
      // Catches SSH form (git@github.com:owner/repo.git) and garbage (Req 2.4, 11.1)
      throw new GitHubIngestionError(
        "invalid-url",
        "The repository URL is invalid.",
      );
    }

    if (url.protocol !== ALLOWED_PROTOCOL) {
      throw new GitHubIngestionError(
        "invalid-url",
        `Disallowed URL scheme "${url.protocol}". Only https is supported.`, // Req 2.2
      );
    }
    // host (not hostname+port) compared exactly; rejects evil.com,
    // raw.githubusercontent.com, github.com.attacker.com, and userinfo tricks
    // like https://github.com@evil.com
    if (url.host.toLowerCase() !== ALLOWED_HOST) {
      throw new GitHubIngestionError(
        "invalid-url",
        "Only github.com repositories are supported.", // Req 2.3
      );
    }
    return this.parseRepo(url);
  }

  /** Extract owner/repo from a github.com URL path. Internal helper used by validateUrl. */
  public parseRepo(url: URL): ParsedRepo {
    // Path looks like /owner/repo, /owner/repo.git, or /owner/repo/tree/<ref>...
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new GitHubIngestionError(
        "not-a-repo-url",
        "The URL is not a valid GitHub repository URL.", // Req 2.6
      );
    }
    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/i, "");

    // owner/repo must match GitHub's allowed name characters
    if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) {
      throw new GitHubIngestionError(
        "not-a-repo-url",
        "The URL is not a valid GitHub repository URL.", // Req 2.5, 2.6
      );
    }

    // Optional ref embedded as /tree/<ref> or /commit/<sha>
    let ref: string | undefined;
    if ((segments[2] === "tree" || segments[2] === "commit") && segments[3]) {
      ref = segments.slice(3).join("/"); // refs may contain slashes (feature/x)
    }
    return { owner, repo, ref };
  }

  /**
   * Validate an optional ref against the git ref-name character allowlist.
   * Throws GitHubIngestionError('invalid-ref') on illegal characters.
   * Empty/undefined returns undefined (use the default branch).
   */
  public validateRef(ref: string | undefined): string | undefined {
    if (ref === undefined || ref === "") return undefined; // default branch (Req 1.3 absent)
    if (
      !REF_ALLOWED.test(ref) ||
      ref.includes("..") ||
      ref.includes("@{") ||
      ref.startsWith("-") ||
      ref.startsWith("/") ||
      ref.endsWith("/") ||
      ref.endsWith(".lock")
    ) {
      throw new GitHubIngestionError(
        "invalid-ref",
        `Invalid git ref: "${ref}".`,
      ); // Req 2.7
    }
    return ref;
  }

  /**
   * Stream the GitHub tarball into a buffer/temp file while enforcing
   * MAX_REPO_BYTES and FETCH_TIMEOUT_MS. Aborts (AbortController) on overflow
   * or timeout. Throws GitHubIngestionError('too-large'|'timeout'|'not-found'
   * |'private-no-token'|'network-error').
   */
  public async fetchTarball(
    parsed: ParsedRepo,
    _scanId: string,
  ): Promise<NodeJS.ReadableStream> {
    const refPath = parsed.ref ? `/${encodeURIComponent(parsed.ref)}` : "";
    const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/tarball${refPath}`;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.fetchTimeoutMs,
    );

    const headers: Record<string, string> = {
      "User-Agent": "SlopShield-AI-Scanner",
      Accept: "application/vnd.github+json",
    };
    // Req 9.1: include token if configured; Req 9.4: token never logged/stored.
    if (this.config.githubToken) {
      headers.Authorization = `Bearer ${this.config.githubToken}`;
    }

    let res: Response;
    try {
      res = await fetch(apiUrl, {
        headers,
        signal: controller.signal,
        redirect: "follow",
      });
    } catch (err: any) {
      clearTimeout(timeout);
      if (err?.name === "AbortError") {
        throw new GitHubIngestionError(
          "timeout",
          "Repository fetch timed out.",
        ); // Req 3.6, 11
      }
      throw new GitHubIngestionError(
        "network-error",
        "Network error fetching repository.",
        true,
      ); // Req 11.3, 11.7
    }

    if (res.status === 404) {
      clearTimeout(timeout);
      throw new GitHubIngestionError(
        "not-found",
        "Repository or ref not found.",
      ); // Req 11.2
    }
    if (res.status === 401 || res.status === 403) {
      clearTimeout(timeout);
      // Anonymous request to a private repo, or rate-limited.
      throw new GitHubIngestionError(
        this.config.githubToken ? "network-error" : "private-no-token",
        this.config.githubToken
          ? "GitHub denied the request (rate limit or access)."
          : "Private repositories require a configured GitHub token.", // Req 9.3
        Boolean(this.config.githubToken),
      );
    }
    if (!res.ok || !res.body) {
      clearTimeout(timeout);
      throw new GitHubIngestionError(
        "network-error",
        `Unexpected status ${res.status}.`,
        true,
      );
    }

    // Wrap the web stream and enforce MAX_REPO_BYTES while data flows.
    let received = 0;
    const max = this.config.maxRepoBytes;
    const maxMb = Math.floor(max / (1024 * 1024));
    const source = Readable.fromWeb(res.body as any);
    const capped = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length;
        if (received > max) {
          cb(
            new GitHubIngestionError(
              "too-large",
              `Repository exceeds the configured size limit of ${maxMb} MB.`,
            ),
          ); // Req 3.2
          return;
        }
        cb(null, chunk);
      },
    });
    capped.on("close", () => clearTimeout(timeout));
    return source.pipe(capped);
  }

  /**
   * Gunzip + untar the stream into scanDir with:
   *  - path-traversal guard (reject entries resolving outside scanDir),
   *  - strip of the top-level "{owner}-{repo}-{sha}/" folder GitHub adds,
   *  - exclusion filter (node_modules/.git/build dirs/binaries),
   *  - MAX_FILE_COUNT enforcement (abort on overflow).
   * Throws GitHubIngestionError('too-many-files').
   */
  public async safeExtract(
    tarStream: NodeJS.ReadableStream,
    scanDir: string,
  ): Promise<{ fileCount: number; totalBytes: number }> {
    const resolvedRoot = path.resolve(scanDir);
    let fileCount = 0;
    let totalBytes = 0;
    // Overflow is flagged (not thrown) inside the filter: throwing from
    // node-tar's synchronous filter callback does not reject the pipeline and
    // hangs extraction. Instead we stop accepting entries once the cap is
    // exceeded and surface the error after the pipeline settles (Req 3.4).
    let tooManyFiles = false;

    await pipeline(
      tarStream,
      createGunzip(),
      tar.extract({
        cwd: scanDir,
        // strip the single top-level "{owner}-{repo}-{sha}/" folder GitHub adds (Req 4.4)
        strip: 1,
        // Decide per-entry whether to write it.
        filter: (entryPath: string, stat: tar.ReadEntry | Stats): boolean => {
          const entry = stat as tar.ReadEntry;
          // Once the file-count cap is exceeded, reject all remaining entries
          // so nothing further is written while the stream drains.
          if (tooManyFiles) return false;

          // Exclusions (Req 3.7, 3.8)
          const parts = entryPath.split(/[/\\]/);
          if (parts.some((p) => this.EXCLUDED_DIRS.has(p))) return false;
          if (this.BINARY_EXT.has(path.extname(entryPath).toLowerCase()))
            return false;
          // Reject symlinks and hard links so a malicious archive cannot create
          // a link that later redirects a write outside scanDir (Req 3.9, 3.10).
          if (entry.type === "SymbolicLink" || entry.type === "Link")
            return false;

          // Path-traversal guard (Req 3.9): resolved target must stay inside scanDir.
          const dest = path.resolve(resolvedRoot, entryPath);
          if (
            dest !== resolvedRoot &&
            !dest.startsWith(resolvedRoot + path.sep)
          ) {
            return false; // reject "../" escapes and absolute paths
          }

          if (entry.type === "File") {
            // Flag overflow and reject this entry (and all subsequent ones).
            if (fileCount + 1 > this.config.maxFileCount) {
              tooManyFiles = true;
              return false;
            }
            fileCount += 1;
            totalBytes += entry.size ?? 0;
          }
          return true;
        },
      }),
    );

    // Surface the cap violation after the pipeline has fully settled (Req 3.4).
    if (tooManyFiles) {
      throw new GitHubIngestionError(
        "too-many-files",
        "Repository exceeds the maximum allowed file count.",
      );
    }

    return { fileCount, totalBytes };
  }

  /**
   * Orchestrates validateUrl -> validateRef -> fetchTarball -> safeExtract.
   * On any failure, removes the partially populated scanDir (Req 11.5) and
   * rethrows a GitHubIngestionError.
   */
  public async ingest(
    rawUrl: string,
    ref: string | undefined,
    scanId: string,
    scanDir: string,
  ): Promise<IngestionResult> {
    try {
      const parsed = this.validateUrl(rawUrl);

      // Ref precedence: the explicit `ref` argument takes precedence over the
      // ref parsed from the URL path (/tree/<ref>). The chosen ref is validated
      // and set on the ParsedRepo before fetching.
      const chosenRef = ref !== undefined && ref !== "" ? ref : parsed.ref;
      parsed.ref = this.validateRef(chosenRef);

      const tarStream = await this.fetchTarball(parsed, scanId);
      const { fileCount, totalBytes } = await this.safeExtract(
        tarStream,
        scanDir,
      );

      return { scanDir, fileCount, totalBytes };
    } catch (err) {
      // Remove the partially populated scanDir before rethrowing (Req 11.5).
      if (fs.existsSync(scanDir)) {
        try {
          fs.rmSync(scanDir, { recursive: true, force: true });
        } catch (cleanupErr) {
          this.logger.warn(
            `Failed to clean up scan directory "${scanDir}": ${String(
              cleanupErr,
            )}`,
          );
        }
      }

      if (err instanceof GitHubIngestionError) {
        throw err;
      }
      // Wrap unexpected errors as a network-error GitHubIngestionError so the
      // caller always receives a discriminated ingestion error.
      throw new GitHubIngestionError(
        "network-error",
        err instanceof Error ? err.message : "Repository ingestion failed.",
        true,
      );
    }
  }
}
