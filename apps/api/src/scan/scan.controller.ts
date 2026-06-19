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
import { ScanService } from "./scan.service.js";
import { ReportService } from "../report/report.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { CreateScanInput } from "@slopshield/shared";

@UseGuards(JwtAuthGuard)
@Controller("scans")
export class ScanController {
  constructor(
    private readonly scanService: ScanService,
    private readonly reportService: ReportService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor("file"))
  public async createScan(
    @Body() body: any,
    @Req() req: any,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<any> {
    // Manually parse structure since post multipart form data returns everything as strings
    const input: CreateScanInput = {
      projectId: body.projectId || undefined,
      sourceType: body.sourceType,
      sourceContent: body.sourceContent || undefined,
      sourceRef: body.sourceRef || undefined,
      scanMode: body.scanMode || "full",
      demoSampleId: body.demoSampleId || undefined,
    };

    return this.scanService.createScan(input, req.user.sub, file);
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

  @Get(":id/report")
  public async getReport(@Param("id") id: string): Promise<any> {
    return this.reportService.generateReport(id);
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
