import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { ScanService } from "./scan.service.js";
import { ReportService } from "../report/report.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { CreateScanInput, CreateScanInputSchema } from "@slopshield/shared";
import { AuditService, AUDIT_ACTION } from "../audit/audit.service.js";
import { extractIp } from "../common/request-ip.js";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe.js";
import {
  THROTTLER_NAMES,
  resolveScanThrottle,
} from "../common/throttler.config.js";

@UseGuards(JwtAuthGuard)
@Controller("scans")
export class ScanController {
  constructor(
    private readonly scanService: ScanService,
    private readonly reportService: ReportService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @Throttle({ [THROTTLER_NAMES.default]: resolveScanThrottle() })
  @UseInterceptors(FileInterceptor("file"))
  public async createScan(
    @Body() body: any,
    @Req() req: any,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<any> {
    // Manually parse structure since post multipart form data returns everything as strings
    const assembled = {
      projectId: body.projectId || undefined,
      sourceType: body.sourceType,
      sourceContent: body.sourceContent || undefined,
      sourceRef: body.sourceRef || undefined,
      scanMode: body.scanMode || "full",
      demoSampleId: body.demoSampleId || undefined,
    };

    // Boundary validation: validate the assembled multipart input against the
    // shared schema, rejecting non-conforming bodies with HTTP 400.
    const input: CreateScanInput = new ZodValidationPipe(
      CreateScanInputSchema,
    ).transform(assembled);

    const scanJob = await this.scanService.createScan(
      input,
      req.user.sub,
      file,
    );
    await this.auditService.record({
      actorId: req.user?.sub,
      action: AUDIT_ACTION.SCAN_CREATE,
      target: scanJob?.id,
      ipAddress: extractIp(req),
      metadata: { sourceType: input.sourceType, scanMode: input.scanMode },
    });
    return scanJob;
  }

  @Get()
  public async listScans(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("projectId") projectId?: string,
    @Query("status") status?: string,
  ): Promise<any> {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.scanService.listScans(pageNum, limitNum, projectId, status);
  }

  @Get(":id")
  public async getScan(@Param("id") id: string): Promise<any> {
    return this.scanService.getScan(id);
  }

  @Post(":id/cancel")
  public async cancelScan(@Param("id") id: string): Promise<any> {
    return this.scanService.cancelScan(id);
  }

  @Post(":id/rerun")
  public async rerunScan(
    @Param("id") id: string,
    @Req() req: any,
  ): Promise<any> {
    const scanJob = await this.scanService.rerunScan(id, req.user?.sub);
    await this.auditService.record({
      actorId: req.user?.sub,
      action: AUDIT_ACTION.SCAN_CREATE,
      target: scanJob?.id,
      ipAddress: extractIp(req),
      metadata: { rerunOf: id, sourceType: scanJob?.sourceType },
    });
    return scanJob;
  }

  @Get(":id/report")
  public async getReport(
    @Param("id") id: string,
    @Req() req: any,
  ): Promise<any> {
    const report = await this.reportService.generateReport(id);
    await this.auditService.record({
      actorId: req.user?.sub,
      action: AUDIT_ACTION.REPORT_VIEW,
      target: id,
      ipAddress: extractIp(req),
    });
    return report;
  }

  @Get(":id/findings")
  public async getFindings(
    @Param("id") id: string,
    @Query("category") category?: string,
    @Query("severity") severity?: string,
    @Query("falsePositive") falsePositive?: string,
  ): Promise<any[]> {
    const isFalsePositive =
      falsePositive !== undefined ? falsePositive === "true" : undefined;
    return this.scanService.getFindings(
      id,
      category,
      severity,
      isFalsePositive,
    );
  }
}
