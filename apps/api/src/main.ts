// =============================================================================
// SlopShield AI — NestJS Application Entry Point
// =============================================================================
// Bootstraps the NestJS application with security headers (Helmet),
// response compression, CORS configuration, and a global API prefix.
// =============================================================================

import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import helmet from "helmet";
import compression from "compression";

import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { resolvePort, findMissingEnv } from "./common/env";

export async function bootstrap(): Promise<void> {
  const logger = new Logger("Bootstrap");

  // ---------------------------------------------------------------------------
  // Boot-time env validation — in production, abort the boot if any required
  // environment variable is missing so deployment failures surface clearly.
  // ---------------------------------------------------------------------------
  const missing = findMissingEnv();
  if (missing.length > 0) {
    logger.error(
      `Missing required environment variable(s) in production: ${missing.join(", ")}`,
    );
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }

  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log", "debug", "verbose"],
  });

  // ---------------------------------------------------------------------------
  // Security — Helmet sets various HTTP headers to protect against common
  // attacks such as XSS, click-jacking, and MIME-type sniffing.
  // ---------------------------------------------------------------------------
  app.use(helmet());

  // ---------------------------------------------------------------------------
  // Compression — gzip/deflate compression reduces response payload sizes,
  // improving throughput for clients on slower networks.
  // ---------------------------------------------------------------------------
  app.use(compression());

  // ---------------------------------------------------------------------------
  // CORS — Cross-Origin Resource Sharing allows the Next.js frontend
  // (default http://localhost:3000) to communicate with the API.
  // ---------------------------------------------------------------------------
  const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
  });

  // ---------------------------------------------------------------------------
  // Global prefix — all routes are mounted under /api so the frontend
  // reverse-proxy can easily distinguish API traffic.
  // ---------------------------------------------------------------------------
  app.setGlobalPrefix("api");

  // ---------------------------------------------------------------------------
  // Global filters & interceptors — applied to every incoming request.
  // ---------------------------------------------------------------------------
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // ---------------------------------------------------------------------------
  // Start listening on the resolved port. Precedence: PORT (injected by Render)
  // → API_PORT → 3001. Bind 0.0.0.0 so the host can route external traffic.
  // ---------------------------------------------------------------------------
  const port = resolvePort();
  await app.listen(port, "0.0.0.0");

  logger.log(
    `🛡️  SlopShield AI API is running on http://localhost:${port}/api`,
  );
  logger.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
  logger.log(`🌐 CORS origin: ${corsOrigin}`);
}

// Only auto-bootstrap when this module is the process entry point. This keeps
// `bootstrap()` importable (and awaitable) from unit tests without triggering a
// fire-and-forget boot at import time. Errors during the real boot exit non-zero
// so deployment failures surface clearly.
if (require.main === module) {
  bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
