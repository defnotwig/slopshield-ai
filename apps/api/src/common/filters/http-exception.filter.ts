import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  public catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Internal server error';
    let error = 'InternalServerError';
    let details: any = undefined;

    if (exception instanceof HttpException) {
      const resContent: any = exception.getResponse();
      if (typeof resContent === 'object' && resContent !== null) {
        message = resContent.message || exception.message;
        error = resContent.error || exception.name;
        details = resContent.details || undefined;
      } else {
        message = resContent || exception.message;
        error = exception.name;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
      // Log stack trace for unhandled errors
      this.logger.error(`Unhandled exception: ${exception.message}`, exception.stack);
    } else {
      this.logger.error(`Unknown exception type: ${String(exception)}`);
    }

    const responseBody = {
      statusCode: status,
      message,
      error,
      details,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId: request.requestId || 'unknown',
    };

    response.status(status).json(responseBody);
  }
}
