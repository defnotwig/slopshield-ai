import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { NotificationService } from "./notification.service.js";
import { AuditService, AUDIT_ACTION } from "../audit/audit.service.js";
import { extractIp } from "../common/request-ip.js";

@UseGuards(JwtAuthGuard)
@Controller()
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly auditService: AuditService,
  ) {}

  @Get("users/notifications")
  public async getSettings(@Req() req: any): Promise<any> {
    return this.notificationService.getSettings(req.user.sub);
  }

  @Patch("users/notifications")
  public async updateSettings(
    @Req() req: any,
    @Body() body: any,
  ): Promise<any> {
    return this.notificationService.updateSettings(req.user.sub, body);
  }

  @Get("projects/:projectId/members")
  public async listMembers(
    @Param("projectId") projectId: string,
  ): Promise<any[]> {
    return this.notificationService.listProjectMembers(projectId);
  }

  @Post("projects/:projectId/members")
  public async addMember(
    @Param("projectId") projectId: string,
    @Body() body: { email: string; role?: string },
    @Req() req: any,
  ): Promise<any> {
    const member = await this.notificationService.addProjectMember(
      projectId,
      body.email,
      body.role || "member",
    );
    await this.auditService.record({
      actorId: req.user?.sub,
      action: AUDIT_ACTION.USER_ROLE_CHANGE,
      target: member?.userId ?? body.email,
      ipAddress: extractIp(req),
      metadata: { projectId, role: body.role || "member" },
    });
    return member;
  }

  @Delete("projects/:projectId/members/:memberId")
  public async removeMember(
    @Param("projectId") projectId: string,
    @Param("memberId") memberId: string,
  ): Promise<any> {
    return this.notificationService.removeProjectMember(projectId, memberId);
  }
}
