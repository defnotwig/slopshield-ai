import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

  public async create(data: any): Promise<any> {
    return this.prisma.project.create({ data });
  }

  public async findAll(): Promise<any[]> {
    return this.prisma.project.findMany({
      include: {
        _count: {
          select: { scanJobs: true },
        },
      },
    });
  }

  public async findOne(id: string): Promise<any> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        scanJobs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project;
  }

  public async update(id: string, data: any): Promise<any> {
    await this.findOne(id); // Throws if not found
    return this.prisma.project.update({
      where: { id },
      data,
    });
  }

  public async remove(id: string): Promise<any> {
    await this.findOne(id);
    return this.prisma.project.delete({
      where: { id },
    });
  }
}
