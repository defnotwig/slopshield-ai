import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ReportService } from './report.service.js';

@Module({
  imports: [PrismaModule],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
