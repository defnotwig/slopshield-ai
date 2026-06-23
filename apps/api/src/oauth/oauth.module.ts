import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OAuthController } from './oauth.controller.js';
import { GitHubOAuthService } from './github-oauth.service.js';
import { LarkOAuthService } from './lark-oauth.service.js';
import { ConnectedAccountService } from './connected-account.service.js';

@Module({
  imports: [AuthModule],
  controllers: [OAuthController],
  providers: [GitHubOAuthService, LarkOAuthService, ConnectedAccountService],
  exports: [ConnectedAccountService, GitHubOAuthService, LarkOAuthService],
})
export class OAuthModule {}
