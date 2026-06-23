// Feature: production-grade-system, Property 30: Security-relevant actions are audit-logged
import "reflect-metadata";
import fc from "fast-check";
import {
  AuditService,
  AUDIT_ACTION,
  AuditRecordInput,
} from "./audit.service";

/**
 * Property 30: Security-relevant actions are audit-logged
 *
 * For any security-relevant action (login, scan creation, report view,
 * Lark send, false-positive marking, and admin role changes), the
 * AuditService.record() persists an audit log entry with the correct
 * actor, action, target, IP address, and metadata.
 *
 * Strategy: fast-check generates arbitrary combinations of the six
 * security-relevant action types with random actor IDs, targets, IP
 * addresses, and metadata. We verify that:
 *   (A) Every call to record() results in exactly one prisma.auditLog.create
 *       invocation with matching fields.
 *   (B) The persisted entry faithfully reflects the input (actorId, action,
 *       target, ipAddress, metadata).
 *   (C) All six action types from AUDIT_ACTION are accepted.
 *   (D) Persistence failure does not throw — auditing is best-effort.
 *
 * Validates: Requirements 10.6
 */

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** All security-relevant actions defined in AUDIT_ACTION constant. */
const allActions = Object.values(AUDIT_ACTION);

const actionArb = fc.constantFrom(...allActions);

/** Generate a nullable UUID-like actorId. */
const actorIdArb = fc.option(fc.uuid(), { nil: null });

/** Generate a nullable target string. */
const targetArb = fc.option(fc.uuid(), { nil: null });

/** Generate a nullable IP address (v4 or v6-like). */
const ipAddressArb = fc.option(
  fc.oneof(
    // IPv4
    fc
      .tuple(
        fc.integer({ min: 1, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
      )
      .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
    // IPv6 shorthand
    fc.constant("::1"),
  ),
  { nil: null },
);

/** Generate nullable metadata. */
const metadataArb = fc.option(
  fc.dictionary(
    fc.string({ minLength: 1, maxLength: 10 }),
    fc.oneof(fc.string({ maxLength: 30 }), fc.integer(), fc.boolean()),
    { minKeys: 1, maxKeys: 5 },
  ),
  { nil: null },
);

/** A full AuditRecordInput generator. */
const auditRecordInputArb = fc.record({
  actorId: actorIdArb,
  action: actionArb,
  target: targetArb,
  ipAddress: ipAddressArb,
  metadata: metadataArb,
});

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

function createMockPrisma() {
  const createdEntries: any[] = [];
  return {
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        createdEntries.push(data);
        return { id: "mock-id", ...data, createdAt: new Date() };
      }),
    },
    _createdEntries: createdEntries,
  };
}

function createFailingPrisma() {
  return {
    auditLog: {
      create: jest.fn(async () => {
        throw new Error("DB connection failed");
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Feature: production-grade-system, Property 30: Security-relevant actions are audit-logged", () => {
  it("persists an audit log entry with correct actor, action, target, ip, and metadata for any security-relevant action (≥100 iterations)", async () => {
    await fc.assert(
      fc.asyncProperty(auditRecordInputArb, async (input) => {
        const mockPrisma = createMockPrisma();
        const service = new AuditService(mockPrisma as any);

        await service.record(input);

        // Exactly one audit log entry is created
        expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
        expect(mockPrisma._createdEntries).toHaveLength(1);

        const persisted = mockPrisma._createdEntries[0];

        // Actor matches (null-coalesced per service implementation)
        expect(persisted.actorId).toBe(input.actorId ?? null);

        // Action is faithfully persisted
        expect(persisted.action).toBe(input.action);

        // Target matches (null-coalesced per service implementation)
        expect(persisted.target).toBe(input.target ?? null);

        // IP address matches (null-coalesced per service implementation)
        expect(persisted.ipAddress).toBe(input.ipAddress ?? null);

        // Metadata matches: when null, service passes `undefined` which
        // Prisma interprets as "do not set" (field remains unset/null in DB).
        if (input.metadata === null || input.metadata === undefined) {
          expect(persisted.metadata).toBeUndefined();
        } else {
          expect(persisted.metadata).toEqual(input.metadata);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("covers all six security-relevant action types defined in AUDIT_ACTION (≥100 iterations)", async () => {
    const observedActions = new Set<string>();

    await fc.assert(
      fc.asyncProperty(auditRecordInputArb, async (input) => {
        const mockPrisma = createMockPrisma();
        const service = new AuditService(mockPrisma as any);

        await service.record(input);

        const persisted = mockPrisma._createdEntries[0];
        observedActions.add(persisted.action);

        // The action persisted must be one of the known AUDIT_ACTION values
        expect(allActions).toContain(persisted.action);
      }),
      { numRuns: 100 },
    );

    // After 100 iterations drawing uniformly from 6 actions, we expect all to
    // be observed (probability of missing one is ~(5/6)^100 ≈ 1.2e-8).
    expect(observedActions.size).toBe(allActions.length);
  });

  it("never throws even when persistence fails — auditing is best-effort (≥100 iterations)", async () => {
    await fc.assert(
      fc.asyncProperty(auditRecordInputArb, async (input) => {
        const failingPrisma = createFailingPrisma();
        const service = new AuditService(failingPrisma as any);

        // Must not throw — failure is swallowed gracefully
        await expect(service.record(input)).resolves.toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it("action field is always a valid AUDIT_ACTION value for generated security-relevant inputs (≥100 iterations)", async () => {
    await fc.assert(
      fc.asyncProperty(
        actionArb,
        actorIdArb,
        targetArb,
        ipAddressArb,
        metadataArb,
        async (action, actorId, target, ipAddress, metadata) => {
          const mockPrisma = createMockPrisma();
          const service = new AuditService(mockPrisma as any);

          const input: AuditRecordInput = {
            actorId,
            action,
            target,
            ipAddress,
            metadata,
          };

          await service.record(input);

          const persisted = mockPrisma._createdEntries[0];

          // The action in the persisted entry matches one of the defined
          // security-relevant actions from the AUDIT_ACTION constant
          expect(allActions).toContain(persisted.action);

          // The action is one of the six security-relevant actions:
          // login, scan.create, report.view, lark.send,
          // finding.false-positive, user.role-change
          expect([
            "login",
            "scan.create",
            "report.view",
            "lark.send",
            "finding.false-positive",
            "user.role-change",
          ]).toContain(persisted.action);
        },
      ),
      { numRuns: 100 },
    );
  });
});
