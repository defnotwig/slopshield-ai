import {
  Controller,
  Get,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ReadinessReport } from "@slopshield/shared";

import { computeReadiness } from "../common/env.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** Shape returned by {@link HealthController.check} when the service is healthy. */
export interface HealthStatus {
  status: "ok";
  timestamp: string;
  uptime: number;
}

/**
 * Public health-check controller used by Render to monitor the service.
 *
 * No `@UseGuards` is applied, and there is no global guard in this app, so the
 * routes are unauthenticated. Mounted under the `/api` global prefix it serves
 * `GET /api/health` and `GET /api/health/ready`.
 */
@Controller("health") // becomes /api/health via the global prefix
export class HealthController {
  private readonly startedAt = Date.now();

  /**
   * `PrismaService` is injected `@Optional()` so the controller can be booted
   * in isolation (e.g. a hermetic health-module integration test) without
   * wiring the database. When present, it backs the liveness probe below.
   */
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /**
   * Liveness probe. Returns HTTP 200 with a healthy payload when the service
   * and its backing datastore are reachable (Req 12.3). If the underlying
   * datastore is unreachable, throws so Nest responds with HTTP 503 rather than
   * a misleading 200 (Req 12.3a).
   */
  @Get()
  public async check(): Promise<HealthStatus> {
    await this.assertDependenciesHealthy();
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  /**
   * Verify the database is reachable with a trivial round-trip query. When the
   * datastore is unavailable (or the query rejects for any reason) this surfaces
   * a 503 Service Unavailable, ensuring the health endpoint reflects an
   * unhealthy service instead of reporting 200 (Req 12.3a).
   *
   * When no `PrismaService` is wired (optional dependency absent), there is no
   * datastore to probe and the service is considered healthy.
   */
  private async assertDependenciesHealthy(): Promise<void> {
    if (!this.prisma) return;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      // Deliberately omit the underlying error/message to avoid leaking
      // connection details (host/credentials) through the public endpoint.
      throw new ServiceUnavailableException({
        status: "error",
        reason: "database_unreachable",
      });
    }
  }

  /**
   * Readiness probe reporting the status of each optional Integration as
   * `configured`, `skipped`, or `error` without hard-failing (Req 11.6, 11.7).
   * An absent optional integration reports `skipped`. Serves
   * `GET /api/health/ready` via the global prefix.
   */
  @Get("ready")
  public ready(): ReadinessReport {
    return computeReadiness();
  }
}
