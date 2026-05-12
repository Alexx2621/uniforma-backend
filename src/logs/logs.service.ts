import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class LogsService {
  constructor(private prisma: PrismaService) {}

  private readonly actionWhere = {
    OR: [
      { metodo: { in: ['POST', 'PUT', 'PATCH', 'DELETE'] } },
      { endpoint: { contains: '/pdf' } },
      { endpoint: { contains: '/unificados' } },
    ],
  };

  async listar() {
    return this.prisma.logAcceso.findMany({
      where: this.actionWhere,
      orderBy: { id: 'desc' },
      take: 200,
    });
  }

  async listarPorUsuario(usuario: string) {
    return this.prisma.logAcceso.findMany({
      where: {
        usuario,
        ...this.actionWhere,
      },
      orderBy: { id: 'desc' },
      take: 100,
    });
  }
}
