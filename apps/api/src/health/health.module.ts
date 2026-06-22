import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";

/**
 * Declares the public {@link HealthController}. Added to `AppModule.imports`
 * (task 3.3) so `GET /api/health` is served.
 */
@Module({ controllers: [HealthController] })
export class HealthModule {}
