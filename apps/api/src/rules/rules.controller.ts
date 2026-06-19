import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  UseGuards,
} from "@nestjs/common";
import { RulesService } from "./rules.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { Rule } from "@slopshield/shared";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("rules")
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  @Get()
  public async getAllRules(): Promise<Rule[]> {
    return this.rulesService.getAllRules();
  }

  @Roles("admin", "reviewer", "team-lead")
  @Patch(":id")
  public async updateRule(
    @Param("id") id: string,
    @Body() body: Partial<Rule>,
  ): Promise<Rule> {
    return this.rulesService.updateRule(id, body);
  }

  @Roles("admin", "reviewer", "team-lead")
  @Post(":id/enable")
  public async enableRule(@Param("id") id: string): Promise<Rule> {
    return this.rulesService.enableRule(id);
  }

  @Roles("admin", "reviewer", "team-lead")
  @Post(":id/disable")
  public async disableRule(@Param("id") id: string): Promise<Rule> {
    return this.rulesService.disableRule(id);
  }
}
