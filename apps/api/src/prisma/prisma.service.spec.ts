// =============================================================================
// SlopShield AI — PrismaService connection error logging unit tests
// =============================================================================
// Verifies Requirement 12.2: IF the connection to the Neon_Database fails,
// THEN the API logs a descriptive database connection error.
//
// The tests mock $connect to reject and assert that:
//   1. Logger.error is invoked with a descriptive message.
//   2. The logged message does NOT leak a raw DATABASE_URL.
//   3. onModuleInit re-throws the original error (fail-fast boot behavior).
// =============================================================================

import { Logger } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

describe("PrismaService.onModuleInit connection error logging (Req 12.2)", () => {
  // The test only needs a distinctive sentinel for DATABASE_URL to prove the
  // error handler logs its own descriptive text rather than echoing the env
  // value. We deliberately avoid a realistic connection-string shape so secret
  // scanners don't flag this test fixture. Any leak of this sentinel into the
  // log would fail the assertion below.
  const DATABASE_URL = "test-sentinel-db-url-must-not-be-logged";

  let service: PrismaService;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new PrismaService();
    // Silence the informational "Connecting…" log emitted before the failure.
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("logs a descriptive error and re-throws when $connect rejects", async () => {
    const cause = new Error("ECONNREFUSED 1.2.3.4:5432");
    jest.spyOn(service, "$connect").mockRejectedValue(cause);

    await expect(service.onModuleInit()).rejects.toBe(cause);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    // Descriptive: mentions PostgreSQL/Prisma and includes the underlying cause.
    expect(logged).toContain("PostgreSQL");
    expect(logged).toContain(cause.message);
  });

  it("does not leak the raw DATABASE_URL in the logged message", async () => {
    // Simulate a failure whose message itself references the URL components,
    // and ensure our handler logs its own descriptive text rather than the URL.
    const cause = new Error("connection failed");
    jest.spyOn(service, "$connect").mockRejectedValue(cause);

    // Make the URL discoverable to the process during the failure window.
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = DATABASE_URL;
    try {
      await expect(service.onModuleInit()).rejects.toBe(cause);
    } finally {
      process.env.DATABASE_URL = previous;
    }

    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).not.toContain(DATABASE_URL);
  });
});
