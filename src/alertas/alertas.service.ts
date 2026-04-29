import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AlertasGateway } from './alertas.gateway';

@Injectable()
export class AlertasService {
  constructor(
    private prisma: PrismaService,
    private alertasGateway: AlertasGateway,
  ) {}

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

    this.alertasGateway.emitAlertasActualizadas({
      action: 'created',
      tipo: params.tipo,
      usuarios: usuarios.map((usuario) => usuario.id),
      creadas: usuarios.length,
    });

    return { creadas: usuarios.length };
  }

  async crearMensajeActualizacion(params: {
    mensaje: string;
    enviadoPor?: string;
  }) {
    const mensaje = `${params.mensaje || ''}`.trim();
    if (!mensaje) {
      throw new BadRequestException('El mensaje de actualizacion es obligatorio');
    }

    const usuarios = await this.prisma.usuario.findMany({
      where: { activo: true },
      select: {
        id: true,
        rolId: true,
      },
    });

    if (usuarios.length) {
      await this.prisma.alertaInterna.createMany({
        data: usuarios.map((usuario) => ({
          usuarioId: usuario.id,
          rolId: usuario.rolId,
          tipo: 'actualizacion_sistema',
          titulo: 'Actualizacion del sistema',
          mensaje,
          payload: JSON.stringify({
            action: 'force-logout',
            enviadoPor: params.enviadoPor || null,
          }),
        })),
      });
    }

    try {
      const invalidatedAt = new Date();
      const updated = await this.prisma.notificacionConfig.updateMany({
        where: { id: 1 },
        data: { sessionInvalidatedAt: invalidatedAt },
      });
      if (!updated.count) {
        await this.prisma.notificacionConfig.create({
          data: {
            id: 1,
            sessionInvalidatedAt: invalidatedAt,
          },
        });
      }
    } catch (error: any) {
      if (error?.code !== 'P2022') {
        throw error;
      }
    }

    this.alertasGateway.emitAlertasActualizadas({
      action: 'system-update',
      tipo: 'actualizacion_sistema',
      creadas: usuarios.length,
    });
    this.alertasGateway.emitMensajeActualizacion({
      titulo: 'Actualizacion del sistema',
      mensaje,
      enviadoPor: params.enviadoPor,
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
    const result = await this.prisma.alertaInterna.updateMany({
      where: {
        id: alertaId,
        usuarioId,
      },
      data: {
        leida: true,
        leidaEn: new Date(),
      },
    });

    this.alertasGateway.emitAlertasActualizadas({
      action: 'read',
      usuarioId,
      alertaId,
    });

    return result;
  }

  async marcarTodasLeidas(usuarioId: number) {
    const result = await this.prisma.alertaInterna.updateMany({
      where: {
        usuarioId,
        leida: false,
      },
      data: {
        leida: true,
        leidaEn: new Date(),
      },
    });

    this.alertasGateway.emitAlertasActualizadas({
      action: 'read-all',
      usuarioId,
    });

    return result;
  }
}
