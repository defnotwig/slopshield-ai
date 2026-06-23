import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

import { buildStructuredLog } from "../structured-log";

/**
 * Request logging interceptor (Req 10.9).
 *
 * Assigns each request a correlation id (surfaced via the `X-Request-ID`
 * response header) and emits a single structured, secret-redacted JSON log
 * line per request capturing method, path, status code, and duration. Errors
 * are logged at error level; successful responses at info level.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  public intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const response = ctx.getResponse<Response>();

    const requestId = uuidv4();
    request.requestId = requestId;

    // Set X-Request-ID response header
    response.setHeader("X-Request-ID", requestId);

    const { method, url } = request;
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.log(
            buildStructuredLog({
              level: "info",
              event: "http.request",
              requestId,
              method,
              path: url,
              statusCode: response.statusCode,
              durationMs: duration,
            }),
          );
        },
        error: (err: any) => {
          const duration = Date.now() - startTime;
          this.logger.error(
            buildStructuredLog({
              level: "error",
              event: "http.request",
              requestId,
              method,
              path: url,
              statusCode: err?.status ?? 500,
              durationMs: duration,
              error: err?.message ?? String(err),
            }),
          );
        },
      }),
    );
  }
}
