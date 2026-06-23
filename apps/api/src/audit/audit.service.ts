import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * The set of security-relevant actions that produce an Audit_Log entry
 * (Req 10.6, B5). Using a const map keeps action strings consistent across
 * call sites instead of free-typing them.
 */
export const AUDIT_ACTION = {
  LOGIN: "login",
  SCAN_CREATE: "scan.create",
  REPORT_VIEW: "report.view",
  LARK_SEND: "lark.send",
  FINDING_FALSE_POSITIVE: "finding.false-positive",
  USER_ROLE_CHANGE: "user.role-change",
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

/** Input shape for {@link AuditService.record}. */
export interface AuditRecordInput {
  /** The acting user id, or null/undefined for anonymous/system actions. */
  actorId?: string | null;
  /** The security-relevant action being recorded. */
  action: AuditAction | string;
  /** The affected resource id, if any. */
  target?: string | null;
  /** The originating IP address, if known. */
  ipAddress?: string | null;
  /** Optional additional structured context. */
  metadata?: Record<string, unknown> | null;
}

/**
 * Writes Audit_Log entries for security-relevant actions (Req 10.6, B5).
 *
 * Auditing is best-effort: a persistence failure here must never break the
 * underlying action (e.g. a login should still succeed even if the audit row
 * cannot be written), so failures are logged and swallowed.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  public async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: input.actorId ?? null,
          action: input.action,
          target: input.target ?? null,
          ipAddress: input.ipAddress ?? null,
          metadata: (input.metadata ?? undefined) as any,
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to write audit log for action "${input.action}": ${err?.message ?? err}`,
      );
    }
  }
}
