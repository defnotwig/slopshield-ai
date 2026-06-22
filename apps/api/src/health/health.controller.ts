import { Controller, Get } from "@nestjs/common";

/**
 * Public health-check controller used by Render to monitor the service.
 *
 * No `@UseGuards` is applied, and there is no global guard in this app, so the
 * route is unauthenticated. Mounted under the `/api` global prefix it serves
 * `GET /api/health`.
 */
@Controller("health") // becomes /api/health via the global prefix
export class HealthController {
  private readonly startedAt = Date.now();

  @Get()
  public check(): { status: "ok"; timestamp: string; uptime: number } {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }
}
