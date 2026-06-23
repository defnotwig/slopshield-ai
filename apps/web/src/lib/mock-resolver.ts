/**
 * Mock Path Resolver (`apps/web/src/lib/mock-resolver.ts`) — internal
 *
 * Maps REST-style request paths to mock payloads using ordered pattern
 * matching, so the existing TanStack Query hooks need NO changes.
 *
 * Behavior (see design.md "Low-Level Design"):
 * - Split the incoming `path` into a pathname + query string.
 * - Find the first `MockRoute` whose method + pattern matches; extract
 *   `:params` from the pathname.
 * - Apply query params (pagination/filtering) to shape the response.
 * - Throw `ApiError(404, ...)` for unmatched GETs so gaps are obvious during
 *   development; return `undefined` (no-op) for unmatched mutations so demo
 *   flows don't crash.
 * - Never performs any network I/O.
 */

import { ApiError } from "./api-client";
import * as mock from "./mock-data";
import type { ScanJob } from "@slopshield/shared";

export interface MockMatchContext {
  params: Record<string, string>;
  query: URLSearchParams;
  body?: unknown;
}

interface MockRoute {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  pattern: string; // e.g. "/scans/:id/findings"
  resolve(ctx: MockMatchContext): unknown;
}

/** Compile "/scans/:id" -> regex + ordered param names. */
function compile(pattern: string): { re: RegExp; keys: string[] } {
  const keys: string[] = [];
  const re = new RegExp(
    "^" +
      pattern.replace(/:[^/]+/g, (m) => {
        keys.push(m.slice(1));
        return "([^/]+)";
      }) +
      "$",
  );
  return { re, keys };
}

// ---------------------------------------------------------------------------
// Local helpers for mutation routes
// ---------------------------------------------------------------------------

/** Find an item by `id` in a collection, or throw a 404. */
function findOr404<T extends { id: string }>(items: T[], id: string): T {
  const found = items.find((item) => item.id === id);
  if (!found) throw new ApiError(404, `Resource not found: ${id}`);
  return found;
}

/**
 * Build a freshly-queued demo scan job from a create-scan body. Pure and
 * deterministic — uses a fixed timestamp so SSR output stays stable.
 */
function createMockScan(body: unknown): ScanJob {
  const input = (body ?? {}) as {
    projectId?: string;
    sourceType?: ScanJob["sourceType"];
    sourceRef?: string;
    triggerType?: ScanJob["triggerType"];
  };
  const createdAt = "2024-01-18T12:00:00.000Z";
  const job: ScanJob = {
    id: "b9999999-9999-4999-8999-999999999999",
    projectId: input.projectId ?? mock.mockProjects[0]?.id,
    triggerType: input.triggerType ?? "manual",
    sourceType: input.sourceType ?? "paste",
    sourceRef: input.sourceRef,
    status: "queued",
    startedBy: mock.mockMe.id,
    startedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
  return job;
}

/**
 * Return a cancelled copy of an existing demo scan job. Throws 404 when the
 * scan id is unknown.
 */
function cancelMockScan(id: string): ScanJob {
  const job = findOr404(mock.mockScanJobs, id);
  return {
    ...job,
    status: "cancelled",
    completedAt: "2024-01-18T12:05:00.000Z",
    updatedAt: "2024-01-18T12:05:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Ordered route table (more specific patterns precede broader ones)
// ---------------------------------------------------------------------------

const routes: MockRoute[] = [
  {
    method: "GET",
    pattern: "/scans",
    resolve: ({ query }) => {
      const page = Number(query.get("page") ?? "1");
      const limit = Number(query.get("limit") ?? "10");
      const projectId = query.get("projectId") ?? undefined;
      const status = query.get("status") ?? undefined;
      let rows = mock.mockScanJobs;
      if (projectId) rows = rows.filter((s) => s.projectId === projectId);
      if (status) rows = rows.filter((s) => s.status === status);
      const start = (page - 1) * limit;
      return {
        data: rows.slice(start, start + limit),
        page,
        limit,
        total: rows.length,
      };
    },
  },
  {
    method: "GET",
    pattern: "/scans/:id",
    resolve: ({ params }) => {
      const job = mock.mockScanJobs.find((s) => s.id === params.id);
      if (!job) throw new ApiError(404, "Scan not found");
      return job;
    },
  },
  {
    method: "GET",
    pattern: "/scans/:id/findings",
    resolve: ({ params, query }) => {
      let rows = mock.mockFindingsByScanId[params.id] ?? [];
      const category = query.get("category");
      const severity = query.get("severity");
      if (category) rows = rows.filter((f) => f.category === category);
      if (severity) rows = rows.filter((f) => f.severity === severity);
      return rows;
    },
  },
  {
    method: "POST",
    pattern: "/scans",
    resolve: ({ body }) => createMockScan(body),
  },
  {
    method: "POST",
    pattern: "/scans/:id/cancel",
    resolve: ({ params }) => cancelMockScan(params.id),
  },

  {
    method: "GET",
    pattern: "/dashboard/summary",
    resolve: () => mock.mockDashboardSummary,
  },
  {
    method: "GET",
    pattern: "/dashboard/trends",
    resolve: () => mock.mockDashboardTrends,
  },
  {
    method: "GET",
    pattern: "/dashboard/top-issues",
    resolve: () => mock.mockDashboardTopIssues,
  },
  {
    method: "GET",
    pattern: "/dashboard/standards",
    resolve: () => mock.mockDashboardStandards,
  },

  {
    method: "GET",
    pattern: "/projects",
    resolve: () => mock.mockProjects,
  },
  {
    method: "GET",
    pattern: "/projects/:id",
    resolve: ({ params }) => findOr404(mock.mockProjects, params.id),
  },

  {
    method: "GET",
    pattern: "/rules",
    resolve: () => mock.mockRules,
  },
  {
    method: "GET",
    pattern: "/auth/me",
    resolve: () => mock.mockMe,
  },
  {
    method: "GET",
    pattern: "/users/notifications",
    resolve: () => mock.mockNotificationSettings,
  },
];

/**
 * Resolve a REST-style `(method, path)` request to a typed mock payload.
 *
 * Preconditions: `path` is a REST-style path beginning with `/` (optionally
 *   followed by a query string).
 * Postconditions: returns a typed mock payload for a matched route; throws
 *   `ApiError(404, ...)` for unmatched GETs; returns `undefined` for unmatched
 *   mutations; never performs network I/O.
 */
export function resolveMock<T>(
  method: string,
  path: string,
  body?: unknown,
): T {
  const [pathname, qs = ""] = path.split("?");
  const query = new URLSearchParams(qs);

  for (const route of routes) {
    if (route.method !== method) continue;
    const { re, keys } = compile(route.pattern);
    const m = re.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return route.resolve({ params, query, body }) as T;
  }

  // Mutations we don't model yet succeed as no-ops so demo flows don't crash.
  // Surface them via a console warning so silent no-ops are visible during
  // development (Req 2.6, resolves C2).
  if (method !== "GET") {
    console.warn(
      `[mock-resolver] Unmodeled mutation no-op: ${method} ${pathname}. ` +
        `Returning undefined; no mock route handles this request.`,
    );
    return undefined as T;
  }

  throw new ApiError(404, `No mock route for ${method} ${pathname}`);
}
