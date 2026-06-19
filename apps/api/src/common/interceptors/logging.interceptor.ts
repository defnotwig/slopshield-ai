import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  public intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const response = ctx.getResponse<Response>();

    const requestId = uuidv4();
    request.requestId = requestId;

    // Set X-Request-ID response header
    response.setHeader('X-Request-ID', requestId);

    const { method, url } = request;
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;
          this.logger.log(`[${requestId}] ${method} ${url} ${statusCode} - ${duration}ms`);
        },
        error: (err: any) => {
          const duration = Date.now() - startTime;
          const statusCode = err.status || 500;
          this.logger.error(`[${requestId}] ${method} ${url} ${statusCode} - ${duration}ms - Error: ${err.message || err}`);
        }
      })
    );
  }
}
