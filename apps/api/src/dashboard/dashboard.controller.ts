import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  public async getSummary(@Query('projectId') projectId?: string): Promise<any> {
    return this.dashboardService.getSummary(projectId);
  }

  @Get('trends')
  public async getTrends(@Query('projectId') projectId?: string): Promise<any[]> {
    return this.dashboardService.getTrends(projectId);
  }

  @Get('top-issues')
  public async getTopIssues(@Query('projectId') projectId?: string): Promise<any[]> {
    return this.dashboardService.getTopIssues(projectId);
  }

  @Get('standards')
  public async getStandards(@Query('projectId') projectId?: string): Promise<any[]> {
    return this.dashboardService.getStandardsViolations(projectId);
  }
}
