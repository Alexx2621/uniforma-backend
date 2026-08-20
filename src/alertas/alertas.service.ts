import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AlertasGateway } from './alertas.gateway';

@Injectable()
export class AlertasService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertasService.name);
  private scheduler?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private alertasGateway: AlertasGateway,
  ) {}

  onModuleInit() {
    // Bajo Passenger (cPanel) la app se duerme sin trafico y el intervalo deja
    // de correr; ahi el barrido lo dispara un cron via AlertasCronController.
    // Si el token del cron existe, ese trabajo externo es la unica fuente. Cada
    // instancia de Passenger ejecutaria su propio intervalo y multiplicaria
    // consultas y procesos despues de un despliegue.
    const cronExternoConfigurado = Boolean(
      process.env.OPERACIONES_CRON_TOKEN || process.env.ALERTAS_CRON_TOKEN,
    );
    if (
      process.env.ALERTAS_SCHEDULER_DISABLED === 'true' ||
      cronExternoConfigurado
    ) {
      return;
    }

    this.scheduler = setInterval(() => {
      // Con 'void' un fallo aqui se convertia en rechazo no capturado y mataba
      // el proceso. Siendo una tarea de fondo, nunca debe tumbar la aplicacion.
      this.emitirAlertasProgramadasVencidas().catch((e) =>
        this.logger.error(
          'Fallo el barrido de alertas programadas',
          e?.message || e,
        ),
      );
    }, 30000);
  }

  onModuleDestroy() {
    if (this.scheduler) clearInterval(this.scheduler);
  }

  async crearAlertasPorRoles(params: {
    roleIds: number[];
    tipo: string;
    titulo: string;
    mensaje: string;
    payload?: Record<string, unknown>;
  }) {
    const roleIds = Array.from(
      new Set(params.roleIds.filter((id) => Number.isFinite(id))),
    );
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

  async crearAlertasPorUsuarios(params: {
    usuarioIds: number[];
    tipo: string;
    titulo: string;
    mensaje: string;
    payload?: Record<string, unknown>;
  }) {
    const usuarioIds = Array.from(
      new Set(
        params.usuarioIds
          .map(Number)
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    );
    if (!usuarioIds.length) return { creadas: 0 };

    const usuarios = await this.prisma.usuario.findMany({
      where: {
        id: { in: usuarioIds },
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

  emitirAutorizacionPedidoResuelta(payload: Record<string, unknown>) {
    this.alertasGateway.emitAutorizacionPedidoResuelta(payload);
  }

  async marcarAlertasAutorizacionPedidoLeidas(autorizacionPedidoIds: number[]) {
    const ids = Array.from(
      new Set(
        autorizacionPedidoIds
          .map(Number)
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    );
    if (!ids.length) return { actualizadas: 0 };

    const alertas = await this.prisma.alertaInterna.findMany({
      where: {
        leida: false,
        tipo: {
          in: [
            'pedido_produccion_autorizacion',
            'pedido_produccion_edicion_autorizacion',
            'orden_mixta_autorizacion',
          ],
        },
      },
      select: { id: true, payload: true },
    });

    const alertaIds = alertas
      .filter((alerta) => {
        try {
          const payload = alerta.payload ? JSON.parse(alerta.payload) : {};
          return ids.includes(Number(payload?.autorizacionPedidoId || 0));
        } catch {
          return false;
        }
      })
      .map((alerta) => alerta.id);

    if (!alertaIds.length) return { actualizadas: 0 };

    const result = await this.prisma.alertaInterna.updateMany({
      where: { id: { in: alertaIds } },
      data: { leida: true, leidaEn: new Date() },
    });

    this.alertasGateway.emitAlertasActualizadas({
      action: 'read',
      tipo: 'pedido_autorizacion_reemplazada',
      alertas: alertaIds,
    });

    return { actualizadas: result.count };
  }

  /**
   * Una solicitud de traslado se envia a todos los usuarios habilitados de la
   * bodega. Cuando cualquiera responde, la misma decision deja de estar
   * pendiente para todos, no solo para quien hizo clic.
   */
  async marcarAlertasSolicitudTrasladoLeidas(solicitudTrasladoIds: number[]) {
    const ids = Array.from(
      new Set(
        solicitudTrasladoIds
          .map(Number)
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    );
    if (!ids.length) return { actualizadas: 0 };

    const alertas = await this.prisma.alertaInterna.findMany({
      where: { leida: false, tipo: 'solicitud_traslado' },
      select: { id: true, payload: true },
    });
    const alertaIds = alertas
      .filter((alerta) => {
        const payload = this.safePayload(alerta.payload);
        return ids.includes(Number(payload?.solicitudTrasladoId || 0));
      })
      .map((alerta) => alerta.id);

    if (!alertaIds.length) return { actualizadas: 0 };

    const result = await this.prisma.alertaInterna.updateMany({
      where: { id: { in: alertaIds } },
      data: { leida: true, leidaEn: new Date() },
    });
    this.alertasGateway.emitAlertasActualizadas({
      action: 'read',
      tipo: 'solicitud_traslado_resuelta',
      solicitudes: ids,
      alertas: alertaIds,
    });
    return { actualizadas: result.count };
  }

  async crearMensajeActualizacion(params: {
    mensaje: string;
    enviadoPor?: string;
  }) {
    const mensaje = `${params.mensaje || ''}`.trim();
    if (!mensaje) {
      throw new BadRequestException(
        'El mensaje de actualizacion es obligatorio',
      );
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

  async crearAlertaManual(
    authUser:
      | { id?: number; usuario?: string; rol?: string; permisos?: string[] }
      | undefined,
    body: {
      titulo?: string;
      mensaje?: string;
      prioridad?: string;
      destinatarioTipo?: string;
      usuarioIds?: number[];
      rolIds?: number[];
      programadaPara?: string | null;
    },
  ) {
    this.ensureCanManage(authUser);
    const titulo = `${body?.titulo || ''}`.trim();
    const mensaje = `${body?.mensaje || ''}`.trim();
    if (!titulo) throw new BadRequestException('El titulo es obligatorio');
    if (!mensaje) throw new BadRequestException('El mensaje es obligatorio');

    const prioridad = this.normalizePrioridad(body?.prioridad);
    const programadaPara = this.parseProgramadaPara(body?.programadaPara);
    const usuarios = await this.getUsuariosDestino(body);
    if (!usuarios.length) {
      throw new BadRequestException(
        'No hay usuarios activos para enviar la alerta',
      );
    }

    const batchId = `alerta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const enviadaEn =
      !programadaPara || programadaPara.getTime() <= now.getTime()
        ? now.toISOString()
        : null;
    const payload = {
      batchId,
      prioridad,
      programadaPara: programadaPara?.toISOString() || null,
      enviadaEn,
      enviadoPor: authUser?.usuario || null,
      destinatarioTipo: body?.destinatarioTipo || 'todos',
    };

    await this.prisma.alertaInterna.createMany({
      data: usuarios.map((usuario) => ({
        usuarioId: usuario.id,
        rolId: usuario.rolId,
        tipo: 'alerta_manual',
        titulo,
        mensaje,
        payload: JSON.stringify(payload),
      })),
    });

    if (enviadaEn) {
      this.alertasGateway.emitAlertasActualizadas({
        action: 'manual-created',
        tipo: 'alerta_manual',
        prioridad,
        usuarios: usuarios.map((usuario) => usuario.id),
        creadas: usuarios.length,
      });
    }

    return {
      batchId,
      creadas: usuarios.length,
      prioridad,
      programadaPara: programadaPara?.toISOString() || null,
      estado: enviadaEn ? 'enviada' : 'programada',
    };
  }

  async listarCampanas(authUser?: { rol?: string; permisos?: string[] }) {
    this.ensureCanManage(authUser);
    const alertas = await this.prisma.alertaInterna.findMany({
      where: { tipo: 'alerta_manual' },
      include: {
        usuario: { select: { id: true, nombre: true, usuario: true } },
        rol: { select: { id: true, nombre: true } },
      },
      orderBy: { creadaEn: 'desc' },
      take: 500,
    });

    const map = new Map<string, any>();
    for (const alerta of alertas) {
      const payload = this.safePayload(alerta.payload);
      const batchId = payload.batchId || `alerta-${alerta.id}`;
      const current = map.get(batchId) || {
        batchId,
        titulo: alerta.titulo,
        mensaje: alerta.mensaje,
        prioridad: payload.prioridad || 'normal',
        programadaPara: payload.programadaPara || null,
        enviadaEn: payload.enviadaEn || null,
        creadaEn: alerta.creadaEn,
        destinatarios: 0,
        leidas: 0,
        roles: new Map<number, string>(),
      };
      current.destinatarios += 1;
      if (alerta.leida) current.leidas += 1;
      if (alerta.rol?.id) current.roles.set(alerta.rol.id, alerta.rol.nombre);
      map.set(batchId, current);
    }

    return Array.from(map.values()).map((item) => ({
      ...item,
      estado: item.programadaPara && !item.enviadaEn ? 'programada' : 'enviada',
      roles: Array.from(item.roles.values()),
    }));
  }

  async listarPorUsuario(usuarioId: number) {
    const alertas = await this.prisma.alertaInterna.findMany({
      where: { usuarioId },
      orderBy: { creadaEn: 'desc' },
      take: 80,
    });
    const now = Date.now();
    const normalizadas = alertas.map((alerta) => ({
      ...alerta,
      payload: this.safePayload(alerta.payload),
    }));

    // Corrige alertas historicas que quedaron abiertas antes de implementar
    // el cierre grupal. Al primer refresco se valida la solicitud real y se
    // retira la accion si alguien ya la resolvio.
    const idsTraslado = Array.from(
      new Set(
        normalizadas
          .filter(
            (alerta) => !alerta.leida && alerta.tipo === 'solicitud_traslado',
          )
          .map((alerta) => Number(alerta.payload?.solicitudTrasladoId || 0))
          .filter((id) => id > 0),
      ),
    );
    if (idsTraslado.length) {
      const pendientes = await this.prisma.solicitudTraslado.findMany({
        where: { id: { in: idsTraslado }, estado: 'PENDIENTE_APROBACION' },
        select: { id: true },
      });
      const pendientesSet = new Set(pendientes.map((item) => item.id));
      const resueltas = idsTraslado.filter((id) => !pendientesSet.has(id));
      if (resueltas.length) {
        await this.marcarAlertasSolicitudTrasladoLeidas(resueltas);
        const resueltasSet = new Set(resueltas);
        normalizadas.forEach((alerta) => {
          if (
            resueltasSet.has(Number(alerta.payload?.solicitudTrasladoId || 0))
          ) {
            alerta.leida = true;
            alerta.leidaEn ||= new Date();
          }
        });
      }
    }

    return normalizadas
      .filter((alerta) => {
        const programadaPara = alerta.payload?.programadaPara
          ? new Date(alerta.payload.programadaPara).getTime()
          : 0;
        return !programadaPara || programadaPara <= now;
      })
      .slice(0, 20);
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

  async emitirAlertasProgramadasVencidas() {
    const alertas = await this.prisma.alertaInterna.findMany({
      where: { tipo: 'alerta_manual' },
      orderBy: { creadaEn: 'desc' },
      take: 500,
    });
    const now = Date.now();
    const dueBatches = new Map<
      string,
      { prioridad: string; usuarios: number[] }
    >();

    for (const alerta of alertas) {
      const payload = this.safePayload(alerta.payload);
      if (!payload?.programadaPara || payload?.enviadaEn) continue;
      const dueAt = new Date(payload.programadaPara).getTime();
      if (!Number.isFinite(dueAt) || dueAt > now) continue;
      const batchId = payload.batchId || `alerta-${alerta.id}`;
      const batch = dueBatches.get(batchId) || {
        prioridad: payload.prioridad || 'normal',
        usuarios: [] as number[],
      };
      batch.usuarios.push(alerta.usuarioId);
      dueBatches.set(batchId, batch);
      await this.prisma.alertaInterna.update({
        where: { id: alerta.id },
        data: {
          payload: JSON.stringify({
            ...payload,
            enviadaEn: new Date().toISOString(),
          }),
        },
      });
    }

    for (const [batchId, batch] of dueBatches.entries()) {
      this.alertasGateway.emitAlertasActualizadas({
        action: 'scheduled-due',
        tipo: 'alerta_manual',
        batchId,
        prioridad: batch.prioridad,
        usuarios: batch.usuarios,
        creadas: batch.usuarios.length,
      });
    }

    return {
      campanasEmitidas: dueBatches.size,
      destinatariosNotificados: Array.from(dueBatches.values()).reduce(
        (total, batch) => total + batch.usuarios.length,
        0,
      ),
    };
  }

  private async getUsuariosDestino(body: {
    destinatarioTipo?: string;
    usuarioIds?: number[];
    rolIds?: number[];
  }) {
    const destinatarioTipo = `${body?.destinatarioTipo || 'todos'}`.trim();
    const where: any = { activo: true };
    if (destinatarioTipo === 'usuarios') {
      const ids = Array.from(
        new Set(
          (body.usuarioIds || [])
            .map(Number)
            .filter((id) => Number.isInteger(id) && id > 0),
        ),
      );
      if (!ids.length)
        throw new BadRequestException('Selecciona al menos un usuario');
      where.id = { in: ids };
    }
    if (destinatarioTipo === 'roles') {
      const ids = Array.from(
        new Set(
          (body.rolIds || [])
            .map(Number)
            .filter((id) => Number.isInteger(id) && id > 0),
        ),
      );
      if (!ids.length)
        throw new BadRequestException('Selecciona al menos un rol');
      where.rolId = { in: ids };
    }
    return this.prisma.usuario.findMany({
      where,
      select: { id: true, rolId: true },
    });
  }

  private ensureCanManage(authUser?: { rol?: string; permisos?: string[] }) {
    const isAdmin = `${authUser?.rol || ''}`.toUpperCase() === 'ADMIN';
    if (isAdmin || authUser?.permisos?.includes('alertas.manage')) return;
    throw new ForbiddenException('No tienes permisos para administrar alertas');
  }

  private normalizePrioridad(value?: string) {
    const prioridad = `${value || 'normal'}`.trim().toLowerCase();
    return ['baja', 'normal', 'alta', 'urgente'].includes(prioridad)
      ? prioridad
      : 'normal';
  }

  private parseProgramadaPara(value?: string | null) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('La fecha programada no es valida');
    }
    return date;
  }

  private safePayload(payload?: string | null) {
    if (!payload) return null;
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
}
