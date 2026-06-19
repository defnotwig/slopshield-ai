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

@UseGuards(JwtAuthGuard)
@Controller()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

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
  ): Promise<any> {
    return this.notificationService.addProjectMember(
      projectId,
      body.email,
      body.role || "member",
    );
  }

  @Delete("projects/:projectId/members/:memberId")
  public async removeMember(
    @Param("projectId") projectId: string,
    @Param("memberId") memberId: string,
  ): Promise<any> {
    return this.notificationService.removeProjectMember(projectId, memberId);
  }
}
