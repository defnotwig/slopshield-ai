import {
  Controller,
  Delete,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { GitHubOAuthService } from './github-oauth.service.js';
import { LarkOAuthService } from './lark-oauth.service.js';
import { ConnectedAccountService } from './connected-account.service.js';

@Controller('oauth')
export class OAuthController {
  constructor(
    private readonly githubOAuthService: GitHubOAuthService,
    private readonly larkOAuthService: LarkOAuthService,
    private readonly connectedAccountService: ConnectedAccountService,
  ) {}

  // ---------------------------------------------------------------------------
  // Connected Accounts listing
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Get('accounts')
  async listConnectedAccounts(@Req() req: any) {
    const userId = req.user.sub;
    return this.connectedAccountService.findAllByUser(userId);
  }

  // ---------------------------------------------------------------------------
  // GitHub OAuth endpoints
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Get('github/authorize')
  async getGitHubAuthUrl(@Req() req: any): Promise<{ url: string }> {
    const userId = req.user.sub;
    const url = await this.githubOAuthService.getAuthorizationUrl(userId);
    return { url };
  }

  @Get('github/callback')
  async handleGitHubCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.githubOAuthService.handleCallback(code, state);
    // Redirect user to the profile page after successful connection
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    res.redirect(`${frontendUrl}/profile`);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('github/disconnect')
  async disconnectGitHub(@Req() req: any): Promise<{ success: boolean }> {
    const userId = req.user.sub;
    const account = await this.connectedAccountService.findByUserAndProvider(
      userId,
      'github',
    );
    if (!account) {
      throw new NotFoundException(
        'No connected account found for this provider',
      );
    }
    await this.githubOAuthService.disconnect(userId);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('github/repos')
  async listGitHubRepos(@Req() req: any) {
    const userId = req.user.sub;
    return this.githubOAuthService.listRepos(userId);
  }

  // ---------------------------------------------------------------------------
  // Lark OAuth endpoints
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Get('lark/authorize')
  getLarkAuthUrl(@Req() req: any): { url: string } {
    const userId = req.user.sub;
    const { url } = this.larkOAuthService.getAuthorizationUrl(userId);
    return { url };
  }

  @Get('lark/callback')
  async handleLarkCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.larkOAuthService.handleCallback(code, state);
    // Redirect user to the profile page after successful connection
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    res.redirect(`${frontendUrl}/profile`);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('lark/disconnect')
  async disconnectLark(@Req() req: any): Promise<{ success: boolean }> {
    const userId = req.user.sub;
    const account = await this.connectedAccountService.findByUserAndProvider(
      userId,
      'lark',
    );
    if (!account) {
      throw new NotFoundException(
        'No connected account found for this provider',
      );
    }
    await this.larkOAuthService.disconnect(userId);
    return { success: true };
  }
}
