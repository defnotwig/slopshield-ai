// =============================================================================
// SlopShield AI — Prisma Module
// =============================================================================
// Global module that provides PrismaService to every other module without
// requiring explicit imports.
// =============================================================================

import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
