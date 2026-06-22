// Unit test for the NestJS bootstrap in `./main`.
//
// Validates:
//   - Requirements 2.4: when the API begins listening, it logs the resolved port.
//   - Requirements 12.1: in production, a missing required env var is logged by
//     name and aborts the boot before the app is created/listens.
//
// `main.ts` exports `bootstrap()` and only auto-runs when it is the process
// entry point, so the test imports `bootstrap` and awaits it directly under
// controlled `process.env` values. `NestFactory` and `./app.module` are mocked
// so no real application is stood up, and the Nest `Logger` is spied on to
// assert the port log line (2.4) and the missing-env error (12.1).

import { Logger } from "@nestjs/common";
import { bootstrap } from "./main";

// ---------------------------------------------------------------------------
// Mock NestFactory so no real application is stood up. The factory returns a
// minimal app stub whose methods are no-op jest mocks; `listen` resolves so the
// bootstrap completes. `./app.module` is mocked to keep the import graph light
// (the real AppModule pulls in BullMQ/Prisma/etc.).
// ---------------------------------------------------------------------------
jest.mock("@nestjs/core", () => {
  const listen = jest.fn().mockResolvedValue(undefined);
  const app = {
    use: jest.fn(),
    enableCors: jest.fn(),
    setGlobalPrefix: jest.fn(),
    useGlobalFilters: jest.fn(),
    useGlobalInterceptors: jest.fn(),
    listen,
  };
  return {
    NestFactory: { create: jest.fn().mockResolvedValue(app) },
    // Re-exported only for the test to assert against the app stub's `listen`.
    __mockApp: app,
  };
});

jest.mock("./app.module", () => ({
  AppModule: class AppModuleStub {
    static readonly __stub = true;
  },
}));

// Typed handles to the mocked NestFactory.create and the app stub's listen.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockedCore = require("@nestjs/core");
const mockCreate: jest.Mock = mockedCore.NestFactory.create;
const mockListen: jest.Mock = mockedCore.__mockApp.listen;

describe("bootstrap (main.ts)", () => {
  const ORIGINAL_ENV = process.env;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Fresh, isolated env per test so PORT/API_PORT/NODE_ENV don't leak.
    process.env = { ...ORIGINAL_ENV };
    logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
    errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const loggedLines = (): string =>
    logSpy.mock.calls.map((c) => String(c[0])).join("\n");

  // -------------------------------------------------------------------------
  // Requirement 2.4 — the API logs the port it begins listening on.
  // -------------------------------------------------------------------------
  it("listens on PORT and logs the resolved port (Req 2.4)", async () => {
    process.env.NODE_ENV = "test";
    process.env.PORT = "8080";
    delete process.env.API_PORT;

    await bootstrap();

    expect(mockListen).toHaveBeenCalledWith(8080, "0.0.0.0");
    expect(loggedLines()).toContain("8080");
  });

  it("falls back to API_PORT when PORT is unset and logs it (Req 2.4)", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.PORT;
    process.env.API_PORT = "4500";

    await bootstrap();

    expect(mockListen).toHaveBeenCalledWith(4500, "0.0.0.0");
    expect(loggedLines()).toContain("4500");
  });

  it("defaults to 3001 when neither PORT nor API_PORT is set and logs it (Req 2.4)", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.PORT;
    delete process.env.API_PORT;

    await bootstrap();

    expect(mockListen).toHaveBeenCalledWith(3001, "0.0.0.0");
    expect(loggedLines()).toContain("3001");
  });

  // -------------------------------------------------------------------------
  // Requirement 12.1 — in production, a missing required env var is logged by
  // name and aborts the boot before creating the app / listening.
  // -------------------------------------------------------------------------
  it("logs each missing required env var by name and aborts before listen in production (Req 12.1)", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    delete process.env.JWT_SECRET;
    delete process.env.CORS_ORIGIN;

    await expect(bootstrap()).rejects.toThrow(/Missing required env/);

    expect(errorSpy).toHaveBeenCalled();
    const errorMsg = String(errorSpy.mock.calls[0][0]);
    expect(errorMsg).toContain("DATABASE_URL");
    expect(errorMsg).toContain("REDIS_URL");
    expect(errorMsg).toContain("JWT_SECRET");
    expect(errorMsg).toContain("CORS_ORIGIN");

    // Aborted before any app creation or listen.
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockListen).not.toHaveBeenCalled();
  });

  it("names only the actually-missing var when others are present (Req 12.1)", async () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://user:pass@host:5432/db";
    process.env.REDIS_URL = "rediss://host:6379";
    process.env.CORS_ORIGIN = "https://example.com";
    delete process.env.JWT_SECRET; // the only missing one

    await expect(bootstrap()).rejects.toThrow(/Missing required env/);

    expect(errorSpy).toHaveBeenCalled();
    const errorMsg = String(errorSpy.mock.calls[0][0]);
    expect(errorMsg).toContain("JWT_SECRET");
    expect(errorMsg).not.toContain("DATABASE_URL");
    expect(errorMsg).not.toContain("REDIS_URL");
    expect(errorMsg).not.toContain("CORS_ORIGIN");

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockListen).not.toHaveBeenCalled();
  });

  it("boots normally and logs the port when all required vars are present in production (Req 2.4, 12.1)", async () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://user:pass@host:5432/db";
    process.env.REDIS_URL = "rediss://host:6379";
    process.env.JWT_SECRET = "secret";
    process.env.CORS_ORIGIN = "https://example.com";
    process.env.PORT = "10000";

    await bootstrap();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith(10000, "0.0.0.0");
    expect(loggedLines()).toContain("10000");
  });
});
