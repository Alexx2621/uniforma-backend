import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class LogsService {
  constructor(private prisma: PrismaService) {}

  async listar() {
    return this.prisma.logAcceso.findMany({
      orderBy: { id: 'desc' },
      take: 200,
    });
  }
}
