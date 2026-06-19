// =============================================================================
// SlopShield AI — NestJS Application Entry Point
// =============================================================================
// Bootstraps the NestJS application with security headers (Helmet),
// response compression, CORS configuration, and a global API prefix.
// =============================================================================

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
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
  const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  });

  // ---------------------------------------------------------------------------
  // Global prefix — all routes are mounted under /api so the frontend
  // reverse-proxy can easily distinguish API traffic.
  // ---------------------------------------------------------------------------
  app.setGlobalPrefix('api');

  // ---------------------------------------------------------------------------
  // Global filters & interceptors — applied to every incoming request.
  // ---------------------------------------------------------------------------
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // ---------------------------------------------------------------------------
  // Start listening on the configured port (default 3001).
  // ---------------------------------------------------------------------------
  const port = process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 3001;
  await app.listen(port);

  logger.log(`🛡️  SlopShield AI API is running on http://localhost:${port}/api`);
  logger.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`🌐 CORS origin: ${corsOrigin}`);
}

bootstrap();
