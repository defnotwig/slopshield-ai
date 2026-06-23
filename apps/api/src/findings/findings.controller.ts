import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
} from "@nestjs/common";
import { FindingsService } from "./findings.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { AuditService, AUDIT_ACTION } from "../audit/audit.service.js";
import { extractIp } from "../common/request-ip.js";

@UseGuards(JwtAuthGuard)
@Controller("findings")
export class FindingsController {
  constructor(
    private readonly findingsService: FindingsService,
    private readonly auditService: AuditService,
  ) {}

  @Get(":id")
  public async findOne(@Param("id") id: string): Promise<any> {
    return this.findingsService.findOne(id);
  }

  @Post(":id/false-positive")
  public async markAsFalsePositive(
    @Param("id") id: string,
    @Body("falsePositive") falsePositive: boolean,
    @Req() req: any,
  ): Promise<any> {
    const result = await this.findingsService.markAsFalsePositive(
      id,
      falsePositive,
    );
    await this.auditService.record({
      actorId: req.user?.sub,
      action: AUDIT_ACTION.FINDING_FALSE_POSITIVE,
      target: id,
      ipAddress: extractIp(req),
      metadata: { falsePositive },
    });
    return result;
  }

  @Post(":id/create-task")
  public async createFixTask(
    @Param("id") id: string,
    @Body("assignedTo") assignedTo?: string,
  ): Promise<any> {
    return this.findingsService.createFixTask(id, assignedTo);
  }

  @Post(":id/generate-fix-plan")
  public async generateFixPlan(@Param("id") id: string): Promise<string[]> {
    return this.findingsService.generateFixPlan(id);
  }
}
