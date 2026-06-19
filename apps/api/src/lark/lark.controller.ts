import { Controller, Post, Body, Query, HttpStatus, HttpCode } from '@nestjs/common';
import { LarkService } from './lark.service.js';

@Controller('lark')
export class LarkController {
  constructor(private readonly larkService: LarkService) {}

  @Post('events')
  @HttpCode(HttpStatus.OK)
  public async handleEvent(@Body() body: any): Promise<any> {
    // Challenge validation for Lark webhooks activation
    if (body && body.type === 'url_verification') {
      return { challenge: body.challenge };
    }
    // Handle standard events
    return { status: 'event-received' };
  }

  @Post('actions')
  @HttpCode(HttpStatus.OK)
  public async handleCardAction(@Body() body: any): Promise<any> {
    // Card interaction button actions payload parses here
    const actionVal = body.action?.value;
    if (actionVal && actionVal.action === 'create-tasks') {
      // Trigger Lark tasks creations for this scan
      await this.larkService.createFixTask(actionVal.scanId);
      return {
        toast: {
          type: 'success',
          content: 'Lark Fix Tasks created successfully!',
        },
      };
    }

    return { status: 'action-processed' };
  }

  @Post('send-report')
  public async sendReport(
    @Query('scanId') scanId: string,
    @Query('chatId') chatId?: string
  ): Promise<any> {
    const success = await this.larkService.sendScanCard(scanId, chatId);
    return { success };
  }
}
