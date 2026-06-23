import { Controller, Post, Get, Body, UseGuards, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service.js";
import { JwtAuthGuard } from "./guards/jwt-auth.guard.js";
import { AuditService, AUDIT_ACTION } from "../audit/audit.service.js";
import { extractIp } from "../common/request-ip.js";
import {
  THROTTLER_NAMES,
  resolveLoginThrottle,
} from "../common/throttler.config.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  @Post("register")
  public async register(@Body() body: any): Promise<any> {
    return this.authService.register(body);
  }

  @Post("login")
  @Throttle({ [THROTTLER_NAMES.default]: resolveLoginThrottle() })
  public async login(@Body() body: any, @Req() req: any): Promise<any> {
    const result = await this.authService.login(body);
    await this.auditService.record({
      actorId: result?.user?.id,
      action: AUDIT_ACTION.LOGIN,
      target: result?.user?.id,
      ipAddress: extractIp(req),
      metadata: { email: result?.user?.email },
    });
    return result;
  }

  @Post("refresh")
  public async refresh(
    @Body("refreshToken") refreshToken: string,
  ): Promise<any> {
    return this.authService.refreshToken(refreshToken);
  }

  @Post("logout")
  public async logout(
    @Body("refreshToken") refreshToken: string,
  ): Promise<any> {
    return this.authService.logout(refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  public async getMe(@Req() req: any): Promise<any> {
    return this.authService.getProfile(req.user.sub);
  }
}
