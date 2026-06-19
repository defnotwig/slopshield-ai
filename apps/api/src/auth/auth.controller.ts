import { Controller, Post, Get, Body, UseGuards, Req } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { JwtAuthGuard } from "./guards/jwt-auth.guard.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  public async register(@Body() body: any): Promise<any> {
    return this.authService.register(body);
  }

  @Post("login")
  public async login(@Body() body: any): Promise<any> {
    return this.authService.login(body);
  }

  @Post("refresh")
  public async refresh(
    @Body("refreshToken") refreshToken: string,
  ): Promise<any> {
    return this.authService.refreshToken(refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  public async getMe(@Req() req: any): Promise<any> {
    return this.authService.getProfile(req.user.sub);
  }
}
