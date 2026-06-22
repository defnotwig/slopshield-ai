import { QueryClient } from "@tanstack/react-query";

/**
 * Shared QueryClient instance used throughout the app.
 *
 * - staleTime 30 s: data is considered fresh for 30 seconds.
 * - retry 3: retries failures a few times so the first request survives a
 *   ~1 min Render cold start while the UI shows a loading state.
 * - retryDelay: exponential backoff capped at 15 s between attempts.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        retry: 3, // survive ~1 min Render cold start (was 1)
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
        refetchOnWindowFocus: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Returns the QueryClient, creating one lazily on the browser.
 * Always creates a fresh one on the server to avoid cross-request leaks.
 */
export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    return makeQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}
