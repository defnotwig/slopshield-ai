import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { FindingsService } from './findings.service.js';
import { FindingsController } from './findings.controller.js';
import { AIReviewerModule } from '../ai-reviewer/ai-reviewer.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, AIReviewerModule, AuthModule, ConfigModule],
  controllers: [FindingsController],
  providers: [FindingsService],
  exports: [FindingsService],
})
export class FindingsModule {}
