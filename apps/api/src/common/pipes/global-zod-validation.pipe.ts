import {
  PipeTransform,
  Injectable,
  BadRequestException,
  ArgumentMetadata,
} from "@nestjs/common";
import { ZodSchema, ZodError } from "zod";

/**
 * A class type that carries a Zod schema as a static `zodSchema` property.
 * DTO classes annotated this way are validated automatically by
 * {@link GlobalZodValidationPipe} wherever they appear as a typed parameter.
 */
export interface ZodSchemaCarrier {
  zodSchema: ZodSchema;
}

function hasZodSchema(metatype: unknown): metatype is ZodSchemaCarrier {
  return (
    typeof metatype === "function" &&
    "zodSchema" in (metatype as object) &&
    (metatype as { zodSchema?: unknown }).zodSchema instanceof ZodSchema
  );
}

/**
 * Application-wide validation pipe (Req 10.1).
 *
 * Registered globally via `APP_PIPE`, it validates any handler parameter whose
 * declared type carries a static `zodSchema`, rejecting non-conforming payloads
 * with an HTTP 400 response. Parameters without an attached schema (primitives,
 * `any`, framework types like `Request`) pass through unchanged, so endpoints
 * that perform their own boundary validation — such as the multipart
 * create-scan route — are unaffected.
 */
@Injectable()
export class GlobalZodValidationPipe implements PipeTransform {
  public transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const { metatype } = metadata;
    if (!hasZodSchema(metatype)) {
      return value;
    }

    try {
      return metatype.zodSchema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          message: "Validation failed",
          error: "Bad Request",
          details: error.errors.map((err) => ({
            field: err.path.join("."),
            message: err.message,
            code: err.code,
          })),
        });
      }
      throw new BadRequestException("Validation failed");
    }
  }
}
