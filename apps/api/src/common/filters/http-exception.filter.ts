import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";

import { redactDeep, buildStructuredLog } from "../structured-log";

/**
 * Global exception filter (Req 10.7, 10.8, 10.9).
 *
 * Responsibilities:
 *  - **Safe responses (Req 10.8):** for unexpected (non-HttpException) errors,
 *    the client receives a generic message and never a stack trace, the
 *    underlying error message, the error class name, or any other internal
 *    implementation detail. Only deliberate {@link HttpException}s (which
 *    carry intentionally client-facing messages) are surfaced to the caller.
 *  - **Redaction (Req 10.7):** every value placed in the response body is run
 *    through secret redaction so a detected credential echoed inside a
 *    validation message can never leak back to the client.
 *  - **Structured logs (Req 10.9):** each handled error is logged as a single
 *    redacted JSON line capturing the request method/path, status, request id,
 *    and (for unexpected errors only) the server-side error detail/stack.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("HttpExceptionFilter");

  public catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // Client-facing fields. Defaults are deliberately generic so that an
    // unexpected error never reveals internal details (Req 10.8).
    let message: unknown = "Internal server error";
    let error = "InternalServerError";
    let details: unknown = undefined;

    if (isHttp) {
      // HttpExceptions carry messages that were intentionally written to be
      // shown to clients (validation errors, 404s, etc.), so they are safe to
      // surface — after redaction.
      const resContent = exception.getResponse();
      if (typeof resContent === "object" && resContent !== null) {
        const body = resContent as Record<string, unknown>;
        message = body.message ?? exception.message;
        error = (body.error as string) ?? exception.name;
        details = body.details;
      } else {
        message = resContent ?? exception.message;
        error = exception.name;
      }
    } else {
      // Unexpected error: keep the full detail server-side only. The client
      // body retains the generic defaults above.
      const detail =
        exception instanceof Error ? exception.message : String(exception);
      const stack =
        exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        buildStructuredLog({
          level: "error",
          event: "request.error",
          requestId: request.requestId ?? "unknown",
          method: request.method,
          path: request.url,
          statusCode: status,
          detail,
          stack,
        }),
      );
    }

    // Build the response body, then redact every string within it (Req 10.7).
    const responseBody = redactDeep({
      statusCode: status,
      message,
      error,
      details,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId: request.requestId ?? "unknown",
    }) as Record<string, unknown>;

    // For HttpExceptions, emit a structured (non-error-level) log line too so
    // every failed request is traceable (Req 10.9).
    if (isHttp) {
      this.logger.warn(
        buildStructuredLog({
          level: "warn",
          event: "request.error",
          requestId: request.requestId ?? "unknown",
          method: request.method,
          path: request.url,
          statusCode: status,
          error,
        }),
      );
    }

    response.status(status).json(responseBody);
  }
}
