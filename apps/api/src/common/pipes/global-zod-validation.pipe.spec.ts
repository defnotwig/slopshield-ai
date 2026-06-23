import { BadRequestException, ArgumentMetadata } from "@nestjs/common";
import { z } from "zod";
import { GlobalZodValidationPipe } from "./global-zod-validation.pipe.js";

class LoginDto {
  static zodSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
  });
}

const meta = (metatype: unknown): ArgumentMetadata =>
  ({ type: "body", metatype } as ArgumentMetadata);

describe("GlobalZodValidationPipe", () => {
  const pipe = new GlobalZodValidationPipe();

  it("validates and returns a conforming payload for a schema-carrying DTO", () => {
    const value = { email: "user@example.com", password: "supersecret" };
    expect(pipe.transform(value, meta(LoginDto))).toEqual(value);
  });

  it("rejects a non-conforming payload with HTTP 400", () => {
    expect(() =>
      pipe.transform({ email: "nope", password: "x" }, meta(LoginDto)),
    ).toThrow(BadRequestException);
  });

  it("passes through values when the metatype carries no zod schema", () => {
    class PlainDto {}
    const value = { anything: true };
    expect(pipe.transform(value, meta(PlainDto))).toBe(value);
  });

  it("passes through primitive metatypes untouched", () => {
    expect(pipe.transform("raw-string", meta(String))).toBe("raw-string");
    expect(pipe.transform(42, meta(Number))).toBe(42);
  });

  it("passes through when metatype is undefined", () => {
    const value = { a: 1 };
    expect(pipe.transform(value, meta(undefined))).toBe(value);
  });

  it("includes structured field-level details on rejection", () => {
    try {
      pipe.transform({ email: "bad" }, meta(LoginDto));
      fail("expected BadRequestException");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        message: string;
        details: Array<{ field: string }>;
      };
      expect(response.message).toBe("Validation failed");
      expect(Array.isArray(response.details)).toBe(true);
    }
  });
});
