import { LarkService } from "./lark.service";
import { AUDIT_ACTION } from "../audit/audit.service";

/**
 * Unit tests for {@link LarkService.sendScanCard} delivery truthfulness.
 * Validates Requirements 9.1, 9.2, 9.3, 9.4, 9.4a, 9.5, 9.7 (Audit B1, B2).
 */
describe("LarkService.sendScanCard (delivery truthfulness)", () => {
  const SCAN_ID = "scan-123";

  const baseScan = {
    id: SCAN_ID,
    sourceRef: "octocat/Hello-World",
    overallScore: 98,
    statusResult: "passed",
    startedBy: "user-1",
    startedByUser: { id: "user-1", name: "Alice Dev", email: "alice@example.com" },
    project: { name: "Hello" },
    findings: [],
  };

  function buildConfig(values: Record<string, string>): any {
    return {
      get: (key: string, fallback = "") => values[key] ?? fallback,
    };
  }

  function buildPrisma(scan: any) {
    return {
      scanJob: { findUnique: jest.fn().mockResolvedValue(scan) },
      larkEvent: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: "event-1", ...data }),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
    };
  }

  const buildAudit = () => ({ record: jest.fn().mockResolvedValue(undefined) });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records `skipped` and does not POST when the webhook is unconfigured (Req 9.2)", async () => {
    const prisma = buildPrisma(baseScan);
    const audit = buildAudit();
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: true } as any);

    const service = new LarkService(
      buildConfig({ PUBLIC_WEB_URL: "https://web.example.com" }), // no LARK_WEBHOOK_URL
      prisma as any,
      audit as any,
    );

    const result = await service.sendScanCard(SCAN_ID);

    expect(result).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.larkEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "skipped" }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTION.LARK_SEND,
        metadata: expect.objectContaining({ outcome: "skipped" }),
      }),
    );
  });

  it("creates `pending` before POST then updates to `success` on a 2xx response (Req 9.3, 9.4)", async () => {
    const prisma = buildPrisma(baseScan);
    const audit = buildAudit();
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: true } as any);

    const service = new LarkService(
      buildConfig({
        LARK_WEBHOOK_URL: "https://open.larksuite.com/webhook",
        PUBLIC_WEB_URL: "https://web.example.com",
      }),
      prisma as any,
      audit as any,
    );

    const result = await service.sendScanCard(SCAN_ID);

    expect(result).toBe(true);
    // pending recorded before fetch
    const createOrder = prisma.larkEvent.create.mock.invocationCallOrder[0];
    const fetchOrder = fetchSpy.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(fetchOrder);
    expect(prisma.larkEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "pending" }),
      }),
    );
    expect(prisma.larkEvent.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { status: "success" },
    });
  });

  it("updates the pending event to `failed` on a non-success response (Req 9.5, 9.4a)", async () => {
    const prisma = buildPrisma(baseScan);
    const audit = buildAudit();
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: false, status: 500 } as any);

    const service = new LarkService(
      buildConfig({
        LARK_WEBHOOK_URL: "https://open.larksuite.com/webhook",
        PUBLIC_WEB_URL: "https://web.example.com",
      }),
      prisma as any,
      audit as any,
    );

    const result = await service.sendScanCard(SCAN_ID);

    expect(result).toBe(false);
    expect(prisma.larkEvent.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { status: "failed" },
    });
    expect(prisma.larkEvent.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "success" } }),
    );
  });

  it("updates the pending event to `failed` when fetch throws (Req 9.5)", async () => {
    const prisma = buildPrisma(baseScan);
    const audit = buildAudit();
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));

    const service = new LarkService(
      buildConfig({
        LARK_WEBHOOK_URL: "https://open.larksuite.com/webhook",
        PUBLIC_WEB_URL: "https://web.example.com",
      }),
      prisma as any,
      audit as any,
    );

    const result = await service.sendScanCard(SCAN_ID);

    expect(result).toBe(false);
    expect(prisma.larkEvent.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { status: "failed" },
    });
  });

  it("builds the card with the real author and a non-localhost report URL (Req 9.1, 9.7)", async () => {
    const prisma = buildPrisma(baseScan);
    const audit = buildAudit();
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: true } as any);

    const service = new LarkService(
      buildConfig({
        LARK_WEBHOOK_URL: "https://open.larksuite.com/webhook",
        PUBLIC_WEB_URL: "https://web.example.com",
      }),
      prisma as any,
      audit as any,
    );

    await service.sendScanCard(SCAN_ID);

    const payload = prisma.larkEvent.create.mock.calls[0][0].data.payload;
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("localhost");
    expect(serialized).not.toContain("Developer");
    expect(serialized).toContain("https://web.example.com/scans/scan-123/report");
  });

  it("falls back to CORS_ORIGIN for the report URL when PUBLIC_WEB_URL is unset (Req 9.1)", async () => {
    const prisma = buildPrisma(baseScan);
    const audit = buildAudit();
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: true } as any);

    const service = new LarkService(
      buildConfig({
        LARK_WEBHOOK_URL: "https://open.larksuite.com/webhook",
        CORS_ORIGIN: "https://cors.example.com",
      }),
      prisma as any,
      audit as any,
    );

    await service.sendScanCard(SCAN_ID);

    const payload = prisma.larkEvent.create.mock.calls[0][0].data.payload;
    expect(JSON.stringify(payload)).toContain(
      "https://cors.example.com/scans/scan-123/report",
    );
  });
});
