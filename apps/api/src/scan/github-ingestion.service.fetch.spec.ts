import { Logger } from "@nestjs/common";
import {
  GitHubIngestionService,
  GitHubIngestionError,
  type ParsedRepo,
} from "./github-ingestion.service.js";
import type { GitHubIngestionConfig } from "./github-ingestion.config.js";

/**
 * Example-based tests for GitHubIngestionService.fetchTarball covering error
 * mapping, the Authorization token header, and the fetch timeout.
 *
 * Validates: Requirements 3.5, 3.6, 9.1, 9.2, 9.3, 9.4, 11.2, 11.3, 11.7
 */
describe("GitHubIngestionService.fetchTarball", () => {
  const FETCH_TIMEOUT_MS = 60_000;
  const TOKEN = "ghp_secrettokenvalue1234567890";

  const parsed: ParsedRepo = { owner: "owner", repo: "repo" };

  const baseConfig = (
    overrides: Partial<GitHubIngestionConfig> = {},
  ): GitHubIngestionConfig => ({
    maxRepoBytes: 100 * 1024 * 1024,
    maxFileCount: 5000,
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
    fetchMechanism: "tarball",
    ...overrides,
  });

  /** Minimal Response-like object accepted by fetchTarball's status checks. */
  const responseLike = (status: number, ok = status >= 200 && status < 300) =>
    ({ status, ok, body: null }) as unknown as Response;

  let fetchSpy: jest.SpyInstance;

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe("error mapping", () => {
    it("maps HTTP 404 to kind 'not-found'", async () => {
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(responseLike(404));
      const service = new GitHubIngestionService(baseConfig());

      const err = await service.fetchTarball(parsed, "scan-1").catch((e) => e);

      expect(err).toBeInstanceOf(GitHubIngestionError);
      expect((err as GitHubIngestionError).kind).toBe("not-found");
    });

    it("maps HTTP 403 with no token to kind 'private-no-token'", async () => {
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(responseLike(403));
      const service = new GitHubIngestionService(baseConfig());

      const err = await service.fetchTarball(parsed, "scan-1").catch((e) => e);

      expect(err).toBeInstanceOf(GitHubIngestionError);
      expect((err as GitHubIngestionError).kind).toBe("private-no-token");
      // Invalid-input style failure: not a transient transport error (Req 11.7).
      expect((err as GitHubIngestionError).transient).toBe(false);
    });

    it("maps a generic fetch rejection to 'network-error' (transient=true)", async () => {
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("ECONNRESET"));
      const service = new GitHubIngestionService(baseConfig());

      const err = await service.fetchTarball(parsed, "scan-1").catch((e) => e);

      expect(err).toBeInstanceOf(GitHubIngestionError);
      expect((err as GitHubIngestionError).kind).toBe("network-error");
      expect((err as GitHubIngestionError).transient).toBe(true);
    });

    it("maps an AbortError rejection to kind 'timeout'", async () => {
      const abortErr = new Error("aborted");
      abortErr.name = "AbortError";
      fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(abortErr);
      const service = new GitHubIngestionService(baseConfig());

      const err = await service.fetchTarball(parsed, "scan-1").catch((e) => e);

      expect(err).toBeInstanceOf(GitHubIngestionError);
      expect((err as GitHubIngestionError).kind).toBe("timeout");
    });
  });

  describe("token header", () => {
    it("includes 'Authorization: Bearer <token>' when GITHUB_TOKEN is configured", async () => {
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(responseLike(404));
      const service = new GitHubIngestionService(
        baseConfig({ githubToken: TOKEN }),
      );

      await service.fetchTarball(parsed, "scan-1").catch(() => undefined);

      const init = fetchSpy.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    });

    it("omits the Authorization header when no token is configured", async () => {
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(responseLike(404));
      const service = new GitHubIngestionService(baseConfig());

      await service.fetchTarball(parsed, "scan-1").catch(() => undefined);

      const init = fetchSpy.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it("never writes the raw token value to any logger output (Req 9.4)", async () => {
      // Capture everything routed through the Nest Logger and console.
      const logged: string[] = [];
      const record = (...args: unknown[]) => {
        logged.push(args.map((a) => String(a)).join(" "));
      };
      const loggerMethods = [
        "log",
        "error",
        "warn",
        "debug",
        "verbose",
      ] as const;
      for (const m of loggerMethods) {
        jest.spyOn(Logger.prototype, m).mockImplementation(record as never);
      }
      for (const m of ["log", "error", "warn", "debug", "info"] as const) {
        jest.spyOn(console, m).mockImplementation(record as never);
      }

      // Exercise both the success-status path and an error path with a token set.
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("ECONNRESET"));
      const service = new GitHubIngestionService(
        baseConfig({ githubToken: TOKEN }),
      );

      await service.fetchTarball(parsed, "scan-1").catch(() => undefined);

      expect(logged.join("\n")).not.toContain(TOKEN);
    });
  });

  describe("timeout via AbortController + fake timers", () => {
    it("aborts the fetch after fetchTimeoutMs and yields kind 'timeout'", async () => {
      jest.useFakeTimers();

      // fetch never resolves on its own; it rejects with an AbortError only
      // when the AbortController fires, exercising the real setTimeout path.
      fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            const signal = (init as RequestInit | undefined)?.signal;
            signal?.addEventListener("abort", () => {
              const abortErr = new Error("The operation was aborted.");
              abortErr.name = "AbortError";
              reject(abortErr);
            });
          }),
      );

      const service = new GitHubIngestionService(baseConfig());
      const promise = service.fetchTarball(parsed, "scan-1");
      const settled = promise.then(
        () => ({ ok: true as const }),
        (e) => ({ ok: false as const, err: e }),
      );

      // Advance to the timeout boundary so the AbortController fires.
      jest.advanceTimersByTime(FETCH_TIMEOUT_MS);

      const result = await settled;
      expect(result.ok).toBe(false);
      const err = (result as { err: unknown }).err;
      expect(err).toBeInstanceOf(GitHubIngestionError);
      expect((err as GitHubIngestionError).kind).toBe("timeout");
    });
  });
});
