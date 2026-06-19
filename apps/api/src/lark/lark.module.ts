import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LarkService } from './lark.service.js';
import { LarkController } from './lark.controller.js';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [LarkController],
  providers: [LarkService],
  exports: [LarkService],
})
export class LarkModule {}
