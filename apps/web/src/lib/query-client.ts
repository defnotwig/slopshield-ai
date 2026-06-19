import { QueryClient } from '@tanstack/react-query';

/**
 * Shared QueryClient instance used throughout the app.
 *
 * - staleTime 30 s: data is considered fresh for 30 seconds.
 * - retry 1: one automatic retry on failure before surfacing the error.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        retry: 1,
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
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}
