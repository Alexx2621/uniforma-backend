import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

@Injectable()
export class LogsService {
  constructor(private prisma: PrismaService) {}

  private readonly actionWhere: Prisma.LogAccesoWhereInput = {
    OR: [
      { endpoint: '/auth/login' },
      { metodo: { in: ['POST', 'PUT', 'PATCH', 'DELETE'] } },
      { endpoint: { contains: '/pdf' } },
    ],
  };

  private readonly knownUserWhere: Prisma.LogAccesoWhereInput = {
    AND: [{ usuario: { not: null } }, { usuario: { not: '' } }],
  };

  async listar(filtros?: { usuario?: string; desde?: string; hasta?: string; texto?: string }) {
    const and: Prisma.LogAccesoWhereInput[] = [this.actionWhere, this.knownUserWhere];

    if (filtros?.usuario?.trim()) {
      and.push({ usuario: { contains: filtros.usuario.trim() } });
    }
    if (filtros?.texto?.trim()) {
      and.push({ endpoint: { contains: filtros.texto.trim() } });
    }
    if (filtros?.desde || filtros?.hasta) {
      and.push({
        fecha: {
          ...(filtros.desde ? { gte: new Date(`${filtros.desde}T00:00:00`) } : {}),
          ...(filtros.hasta ? { lte: new Date(`${filtros.hasta}T23:59:59`) } : {}),
        },
      });
    }

    return this.prisma.logAcceso.findMany({
      where: { AND: and },
      orderBy: { id: 'desc' },
      take: 200,
    });
  }

  async listarPorUsuario(usuario: string) {
    return this.prisma.logAcceso.findMany({
      where: {
        AND: [{ usuario }, this.actionWhere],
      },
      orderBy: { id: 'desc' },
      take: 100,
    });
  }

  async listarPorPedido(pedidoId: number) {
    return this.prisma.logAcceso.findMany({
      where: {
        AND: [
          this.actionWhere,
          this.knownUserWhere,
          {
            endpoint: {
              contains: `/produccion/${pedidoId}`,
            },
          },
        ],
      },
      orderBy: { id: 'desc' },
      take: 100,
    });
  }
}
