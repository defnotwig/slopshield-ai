import { Module } from '@nestjs/common';
import { ScannerOrchestrator } from './scanner.orchestrator.js';

@Module({
  providers: [ScannerOrchestrator],
  exports: [ScannerOrchestrator],
})
export class ScannerModule {}
