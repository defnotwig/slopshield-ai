import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Type,
  mixin,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Observable } from "rxjs";

/**
 * A conditional file interceptor that only activates multer (FileInterceptor)
 * when the request Content-Type is multipart/form-data.
 * JSON requests pass through untouched, allowing the scan endpoint to accept
 * both file uploads (multipart) and JSON payloads (repository scans).
 */
export function ConditionalFileInterceptor(
  fieldName: string,
): Type<NestInterceptor> {
  @Injectable()
  class MixinInterceptor implements NestInterceptor {
    private readonly fileInterceptor: NestInterceptor;

    constructor() {
      const InterceptorClass = FileInterceptor(fieldName);
      this.fileInterceptor = new InterceptorClass();
    }

    intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Observable<any> | Promise<Observable<any>> {
      const request = context.switchToHttp().getRequest();
      const contentType = request.headers["content-type"] || "";

      if (contentType.includes("multipart/form-data")) {
        return this.fileInterceptor.intercept(context, next);
      }

      return next.handle();
    }
  }

  return mixin(MixinInterceptor);
}
