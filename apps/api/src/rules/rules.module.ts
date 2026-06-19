import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RulesService } from './rules.service.js';
import { RulesController } from './rules.controller.js';
import { StandardsMapper } from './standards-mapper.js';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [RulesController],
  providers: [RulesService, StandardsMapper],
  exports: [RulesService, StandardsMapper],
})
export class RulesModule {}
