import { Controller, Get, Post, Param, Body, UseGuards } from "@nestjs/common";
import { FindingsService } from "./findings.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";

@UseGuards(JwtAuthGuard)
@Controller("findings")
export class FindingsController {
  constructor(private readonly findingsService: FindingsService) {}

  @Get(":id")
  public async findOne(@Param("id") id: string): Promise<any> {
    return this.findingsService.findOne(id);
  }

  @Post(":id/false-positive")
  public async markAsFalsePositive(
    @Param("id") id: string,
    @Body("falsePositive") falsePositive: boolean,
  ): Promise<any> {
    return this.findingsService.markAsFalsePositive(id, falsePositive);
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
