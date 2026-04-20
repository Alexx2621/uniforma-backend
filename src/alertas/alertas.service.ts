import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AlertasService {
  constructor(private prisma: PrismaService) {}

  async crearAlertasPorRoles(params: {
    roleIds: number[];
    tipo: string;
    titulo: string;
    mensaje: string;
    payload?: Record<string, unknown>;
  }) {
    const roleIds = Array.from(new Set(params.roleIds.filter((id) => Number.isFinite(id))));
    if (!roleIds.length) return { creadas: 0 };

    const usuarios = await this.prisma.usuario.findMany({
      where: {
        rolId: { in: roleIds },
        activo: true,
      },
      select: {
        id: true,
        rolId: true,
      },
    });

    if (!usuarios.length) return { creadas: 0 };

    await this.prisma.alertaInterna.createMany({
      data: usuarios.map((usuario) => ({
        usuarioId: usuario.id,
        rolId: usuario.rolId,
        tipo: params.tipo,
        titulo: params.titulo,
        mensaje: params.mensaje,
        payload: params.payload ? JSON.stringify(params.payload) : null,
      })),
    });

    return { creadas: usuarios.length };
  }

  async listarPorUsuario(usuarioId: number) {
    const alertas = await this.prisma.alertaInterna.findMany({
      where: { usuarioId },
      orderBy: { creadaEn: 'desc' },
      take: 20,
    });

    return alertas.map((alerta) => ({
      ...alerta,
      payload: alerta.payload ? JSON.parse(alerta.payload) : null,
    }));
  }

  async marcarLeida(usuarioId: number, alertaId: number) {
    return this.prisma.alertaInterna.updateMany({
      where: {
        id: alertaId,
        usuarioId,
      },
      data: {
        leida: true,
        leidaEn: new Date(),
      },
    });
  }

  async marcarTodasLeidas(usuarioId: number) {
    return this.prisma.alertaInterna.updateMany({
      where: {
        usuarioId,
        leida: false,
      },
      data: {
        leida: true,
        leidaEn: new Date(),
      },
    });
  }
}
