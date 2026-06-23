/**
 * Best-effort extraction of the originating client IP address from an Express
 * request, honoring the `x-forwarded-for` header (first hop) when present so
 * audit logs capture the real client behind a proxy/load balancer (Req 10.6).
 */
export function extractIp(req: any): string | null {
  if (!req) {
    return null;
  }
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).trim();
  }
  return req.ip ?? req.socket?.remoteAddress ?? null;
}
