import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateScanInput } from '@slopshield/shared';

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);
  private readonly tempBaseDir: string;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('scan-pipeline') private readonly scanQueue: Queue
  ) {
    this.tempBaseDir = path.join(process.cwd(), 'temp-scans');
    if (!fs.existsSync(this.tempBaseDir)) {
      fs.mkdirSync(this.tempBaseDir, { recursive: true });
    }
  }

  public async createScan(input: CreateScanInput, userId?: string, file?: Express.Multer.File): Promise<any> {
    if (input.sourceType === 'paste' && !input.sourceContent) {
      throw new BadRequestException('Pasted code content is required for sourceType: "paste"');
    }
    if (input.sourceType === 'upload' && !file) {
      throw new BadRequestException('ZIP file upload is required for sourceType: "upload"');
    }
    if (input.sourceType === 'demo-sample' && !input.demoSampleId) {
      throw new BadRequestException('Demo sample ID is required for sourceType: "demo-sample"');
    }

    const scanJob = await this.prisma.scanJob.create({
      data: {
        projectId: input.projectId || null,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef || (file ? file.originalname : null),
        status: 'queued',
        scanMode: input.scanMode || 'full',
        startedBy: userId || null,
      },
    });

    const scanDir = path.join(this.tempBaseDir, scanJob.id);
    fs.mkdirSync(scanDir, { recursive: true });

    // Prepare files in scan directory
    try {
      if (input.sourceType === 'paste') {
        const ext = input.scanMode === 'frontend-only' ? '.tsx' : '.ts';
        const targetFile = path.join(scanDir, `pasted_code${ext}`);
        fs.writeFileSync(targetFile, input.sourceContent || '', 'utf8');
      } else if (input.sourceType === 'upload' && file) {
        // Safe extraction with adm-zip
        const zip = new AdmZip(file.buffer);
        zip.extractAllTo(scanDir, true);
      } else if (input.sourceType === 'demo-sample') {
        const demoId = input.demoSampleId || '';
        const demoDir = path.join(process.cwd(), 'demo-samples', demoId);
        if (!fs.existsSync(demoDir)) {
          throw new BadRequestException(`Demo sample folder ${demoId} not found`);
        }
        this.copyFolderSync(demoDir, scanDir);
      }

      // Add to BullMQ queue
      await this.scanQueue.add('process-scan', {
        scanId: scanJob.id,
        scanDir,
      });

      this.logger.log(`Enqueued scan job: ${scanJob.id}`);
      return scanJob;
    } catch (err: any) {
      this.logger.error(`Failed to ingest files for scan ${scanJob.id}: ${err.message}`);
      await this.prisma.scanJob.update({
        where: { id: scanJob.id },
        data: { status: 'failed', statusResult: 'blocked' },
      });
      // Clean up directory if created
      if (fs.existsSync(scanDir)) {
        fs.rmSync(scanDir, { recursive: true, force: true });
      }
      throw err;
    }
  }

  public async getScan(id: string): Promise<any> {
    const scan = await this.prisma.scanJob.findUnique({
      where: { id },
      include: {
        project: true,
        findings: true,
        scanFiles: true,
      },
    });

    if (!scan) {
      throw new NotFoundException(`Scan job with ID ${id} not found`);
    }

    return scan;
  }

  public async listScans(page = 1, limit = 10, projectId?: string, status?: string): Promise<any> {
    const filter: any = {};
    if (projectId) filter.projectId = projectId;
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.scanJob.findMany({
        where: filter,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { project: true },
      }),
      this.prisma.scanJob.count({ where: filter }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  public async getFindings(scanId: string, category?: string, severity?: string, falsePositive?: boolean): Promise<any[]> {
    const filter: any = { scanJobId: scanId };
    if (category) filter.category = category;
    if (severity) filter.severity = severity;
    if (falsePositive !== undefined) filter.falsePositive = falsePositive;

    return this.prisma.finding.findMany({
      where: filter,
      orderBy: { severity: 'asc' },
    });
  }

  public async cancelScan(id: string): Promise<any> {
    const scan = await this.getScan(id);
    if (scan.status === 'completed' || scan.status === 'failed' || scan.status === 'cancelled') {
      throw new BadRequestException(`Cannot cancel a scan job that is already ${scan.status}`);
    }

    return this.prisma.scanJob.update({
      where: { id },
      data: { status: 'cancelled', completedAt: new Date() },
    });
  }

  private copyFolderSync(from: string, to: string): void {
    if (!fs.existsSync(to)) {
      fs.mkdirSync(to, { recursive: true });
    }
    const elements = fs.readdirSync(from);
    for (const element of elements) {
      const fromPath = path.join(from, element);
      const toPath = path.join(to, element);
      const stats = fs.statSync(fromPath);
      if (stats.isDirectory()) {
        this.copyFolderSync(fromPath, toPath);
      } else {
        fs.copyFileSync(fromPath, toPath);
      }
    }
  }
}
