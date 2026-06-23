// Feature: production-grade-system, Property 25: Lark delivery status reflects the real outcome
//
// For any webhook response (2xx success, non-2xx, or thrown transport error),
// the LarkEvent is created as `pending` before sending and ends as `success`
// if and only if the response indicates success, and `failed` otherwise.
// When the webhook is unconfigured, the LarkEvent is recorded as `skipped`.
//
// Validates: Requirements 9.3, 9.4, 9.5

import fc from "fast-check";
import { LarkService } from "./lark.service";

/**
 * Discriminated webhook outcome type used as the property input space.
 * - "success": HTTP 2xx response
 * - "http-error": HTTP non-2xx response (4xx or 5xx)
 * - "transport-error": fetch throws before a response is received
 * - "unconfigured": webhook URL is not set
 */
type WebhookOutcome =
  | { kind: "success"; statusCode: number }
  | { kind: "http-error"; statusCode: number }
  | { kind: "transport-error"; errorMessage: string }
  | { kind: "unconfigured" };

/**
 * Arbitrary generator for the full space of webhook outcomes.
 * Generates 2xx codes for success, non-2xx for error, arbitrary error messages
 * for transport errors, and the unconfigured case.
 */
const webhookOutcomeArb: fc.Arbitrary<WebhookOutcome> = fc.oneof(
  // Success: any 2xx status
  fc.integer({ min: 200, max: 299 }).map((statusCode) => ({
    kind: "success" as const,
    statusCode,
  })),
  // HTTP error: 4xx or 5xx
  fc.oneof(
    fc.integer({ min: 400, max: 499 }),
    fc.integer({ min: 500, max: 599 }),
  ).map((statusCode) => ({
    kind: "http-error" as const,
    statusCode,
  })),
  // Transport error: fetch throws
  fc.string({ minLength: 1, maxLength: 100 }).map((errorMessage) => ({
    kind: "transport-error" as const,
    errorMessage,
  })),
  // Unconfigured: no webhook URL
  fc.constant({ kind: "unconfigured" as const }),
);

describe("LarkService.sendScanCard — Property 25: Lark delivery status reflects the real outcome", () => {
  const SCAN_ID = "scan-prop25";

  const baseScan = {
    id: SCAN_ID,
    sourceRef: "octocat/Hello-World",
    overallScore: 85,
    statusResult: "passed-with-warnings",
    startedBy: "user-1",
    startedByUser: { id: "user-1", name: "Test User", email: "test@example.com" },
    project: { name: "TestProject" },
    findings: [],
  };

  function buildConfig(webhookUrl: string): any {
    return {
      get: (key: string, fallback = "") => {
        const values: Record<string, string> = {
          LARK_WEBHOOK_URL: webhookUrl,
          PUBLIC_WEB_URL: "https://web.example.com",
          LARK_APP_ID: "",
          LARK_APP_SECRET: "",
        };
        return values[key] ?? fallback;
      },
    };
  }

  function buildPrisma(scan: any) {
    return {
      scanJob: { findUnique: jest.fn().mockResolvedValue(scan) },
      larkEvent: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: "evt-1", ...data }),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
    };
  }

  const buildAudit = () => ({ record: jest.fn().mockResolvedValue(undefined) });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records the correct terminal status for any webhook outcome (numRuns >= 100)", async () => {
    await fc.assert(
      fc.asyncProperty(webhookOutcomeArb, async (outcome) => {
        const prisma = buildPrisma(baseScan);
        const audit = buildAudit();

        // Configure fetch mock based on outcome kind
        let fetchSpy: jest.SpyInstance;
        let webhookUrl: string;

        switch (outcome.kind) {
          case "unconfigured":
            webhookUrl = "";
            fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true } as any);
            break;
          case "success":
            webhookUrl = "https://open.larksuite.com/webhook";
            fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
              ok: true,
              status: outcome.statusCode,
            } as any);
            break;
          case "http-error":
            webhookUrl = "https://open.larksuite.com/webhook";
            fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
              ok: false,
              status: outcome.statusCode,
            } as any);
            break;
          case "transport-error":
            webhookUrl = "https://open.larksuite.com/webhook";
            fetchSpy = jest.spyOn(global, "fetch").mockRejectedValue(
              new Error(outcome.errorMessage),
            );
            break;
        }

        const service = new LarkService(
          buildConfig(webhookUrl),
          prisma as any,
          audit as any,
        );

        await service.sendScanCard(SCAN_ID);

        if (outcome.kind === "unconfigured") {
          // (Req 9.2) When unconfigured, a single `skipped` event is created.
          expect(prisma.larkEvent.create).toHaveBeenCalledTimes(1);
          expect(prisma.larkEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({ status: "skipped" }),
            }),
          );
          // No POST was made.
          expect(fetchSpy).not.toHaveBeenCalled();
          // No update needed since it was created directly as `skipped`.
          expect(prisma.larkEvent.update).not.toHaveBeenCalled();
        } else {
          // (Req 9.3) The event is created as `pending` BEFORE the POST.
          expect(prisma.larkEvent.create).toHaveBeenCalledTimes(1);
          expect(prisma.larkEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({ status: "pending" }),
            }),
          );

          // Verify ordering: create happens before fetch
          const createOrder = prisma.larkEvent.create.mock.invocationCallOrder[0];
          const fetchOrder = fetchSpy.mock.invocationCallOrder[0];
          expect(createOrder).toBeLessThan(fetchOrder);

          if (outcome.kind === "success") {
            // (Req 9.4) Success response → terminal status is `success`.
            expect(prisma.larkEvent.update).toHaveBeenCalledWith({
              where: { id: "evt-1" },
              data: { status: "success" },
            });
            // Never recorded as `failed` when successful.
            expect(prisma.larkEvent.update).not.toHaveBeenCalledWith(
              expect.objectContaining({ data: { status: "failed" } }),
            );
          } else {
            // (Req 9.5) Non-success or transport error → terminal status is `failed`.
            expect(prisma.larkEvent.update).toHaveBeenCalledWith({
              where: { id: "evt-1" },
              data: { status: "failed" },
            });
            // Never recorded as `success` when failed.
            expect(prisma.larkEvent.update).not.toHaveBeenCalledWith(
              expect.objectContaining({ data: { status: "success" } }),
            );
          }
        }

        fetchSpy.mockRestore();
      }),
      { numRuns: 100 },
    );
  });
});
