import { BadRequestException } from "@nestjs/common";
import { CreateScanInputSchema } from "@slopshield/shared";
import { ZodValidationPipe } from "./zod-validation.pipe.js";

describe("ZodValidationPipe (create-scan boundary)", () => {
  const pipe = new ZodValidationPipe(CreateScanInputSchema);

  it("accepts a conforming assembled multipart input and applies defaults", () => {
    const result = pipe.transform({
      sourceType: "paste",
      sourceContent: "console.log('hi')",
    });

    expect(result.sourceType).toBe("paste");
    // scanMode default is applied by the schema at the boundary.
    expect(result.scanMode).toBe("full");
  });

  it("rejects a body with an invalid sourceType with HTTP 400", () => {
    expect(() =>
      pipe.transform({ sourceType: "not-a-real-source" }),
    ).toThrow(BadRequestException);
  });

  it("rejects a body missing the required sourceType with HTTP 400", () => {
    expect(() => pipe.transform({ sourceContent: "x" })).toThrow(
      BadRequestException,
    );
  });

  it("rejects a non-uuid projectId with HTTP 400", () => {
    expect(() =>
      pipe.transform({ sourceType: "paste", projectId: "not-a-uuid" }),
    ).toThrow(BadRequestException);
  });

  it("includes structured field-level details on rejection", () => {
    try {
      pipe.transform({ sourceType: "nope" });
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
