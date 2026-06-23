import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { AuditService } from "./audit.service.js";

/**
 * Global module exposing {@link AuditService} so any feature module can record
 * security-relevant actions without re-importing (Req 10.6, B5).
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
