import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ProjectService } from './project.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Post()
  public async create(@Body() body: any): Promise<any> {
    return this.projectService.create(body);
  }

  @Get()
  public async findAll(): Promise<any[]> {
    return this.projectService.findAll();
  }

  @Get(':id')
  public async findOne(@Param('id') id: string): Promise<any> {
    return this.projectService.findOne(id);
  }

  @Patch(':id')
  public async update(@Param('id') id: string, @Body() body: any): Promise<any> {
    return this.projectService.update(id, body);
  }

  @Delete(':id')
  public async remove(@Param('id') id: string): Promise<any> {
    return this.projectService.remove(id);
  }
}
