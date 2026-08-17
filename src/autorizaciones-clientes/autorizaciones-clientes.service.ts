import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AlertasService } from '../alertas/alertas.service';

@Injectable()
export class AutorizacionesClientesService {
  private readonly logger = new Logger(AutorizacionesClientesService.name);

  constructor(
    private prisma: PrismaService,
    private alertas: AlertasService,
  ) {}

  private etiquetaModulo(modulo: string) {
    if (modulo === 'pedido') return 'un pedido';
    if (modulo === 'orden_mixta') return 'una orden mixta';
    return 'una venta';
  }

  private async nombreDe(usuarioId: number, respaldo?: any) {
    const directo = `${respaldo?.nombre || respaldo?.usuario || ''}`.trim();
    if (directo) return directo;
    const u = await this.prisma.usuario.findUnique({
      where: { id: Number(usuarioId) },
      select: { nombre: true, usuario: true },
    });
    return `${u?.nombre || u?.usuario || 'Un vendedor'}`.trim();
  }

  /**
   * Las notificaciones nunca deben tumbar la operacion de negocio: si el envio
   * falla, la solicitud ya quedo registrada y se puede consultar en pendientes.
   */
  private async avisar(params: {
    usuarioIds: number[];
    tipo: string;
    titulo: string;
    mensaje: string;
    payload?: Record<string, unknown>;
  }) {
    try {
      await this.alertas.crearAlertasPorUsuarios(params);
    } catch (e: any) {
      this.logger.error(`No se pudo enviar la alerta ${params.tipo}`, e?.message || e);
    }
  }

  async solicitar(user: any, body: any) {
    const solicitanteId = Number(user?.id || 0);
    const clienteId = Number(body?.clienteId || 0);
    const cliente = await this.prisma.cliente.findUnique({
      where: { id: clienteId },
      include: { usuario: { select: { id: true, nombre: true, usuario: true } } },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    const propietarioId = Number(cliente.usuarioId || 0);
    const modulo = ['venta', 'pedido', 'orden_mixta'].includes(`${body?.modulo || ''}`) ? `${body.modulo}` : 'venta';
    if (!propietarioId) throw new BadRequestException('El cliente no tiene vendedor asignado');
    if (propietarioId === solicitanteId) return { estado: 'propio' };

    const vigente = await this.prisma.autorizacionVentaCliente.findFirst({
      where: { clienteId, solicitanteId, modulo, ventaId: null, operacionId: null, estado: { in: ['pendiente', 'aprobado'] } },
      orderBy: { creadoEn: 'desc' },
    });
    // Ya hay una vigente: no se vuelve a avisar para no repetir la alerta cada
    // vez que el solicitante reintente la operacion.
    if (vigente) return vigente;

    const motivo = `${body?.motivo || 'Venta solicitada por otro vendedor'}`.trim();
    const creada = await this.prisma.autorizacionVentaCliente.create({
      data: { clienteId, solicitanteId, propietarioId, modulo, motivo },
    });

    const solicitante = await this.nombreDe(solicitanteId, user);
    await this.avisar({
      usuarioIds: [propietarioId],
      tipo: 'autorizacion_cliente',
      titulo: 'Solicitud de autorizacion de cliente',
      mensaje: `${solicitante} necesita tu autorizacion para generar ${this.etiquetaModulo(modulo)} al cliente ${cliente.nombre}, que pertenece a tu cartera. Motivo: ${motivo}`,
      payload: {
        autorizacionClienteId: creada.id,
        prioridad: 'alta',
        modulo,
        clienteId,
        cliente: cliente.nombre,
        solicitanteId,
        solicitante,
        motivo,
      },
    });

    return creada;
  }

  listarPendientes(user: any) {
    return this.prisma.autorizacionVentaCliente.findMany({
      where: { propietarioId: Number(user?.id || 0), estado: 'pendiente' },
      include: { cliente: true, solicitante: { select: { id: true, nombre: true, usuario: true } } },
      orderBy: { creadoEn: 'asc' },
    });
  }

  async resolver(id: number, user: any, aprobar: boolean, body: any) {
    const row = await this.prisma.autorizacionVentaCliente.findUnique({
      where: { id },
      include: { cliente: { select: { nombre: true } } },
    });
    if (!row) throw new NotFoundException('Autorizacion no encontrada');
    if (row.propietarioId !== Number(user?.id || 0)) throw new ForbiddenException('Solo el vendedor propietario puede resolverla');
    if (row.estado !== 'pendiente') throw new BadRequestException('La solicitud ya fue resuelta');

    const comentario = `${body?.comentario || ''}`.trim();
    const actualizada = await this.prisma.autorizacionVentaCliente.update({
      where: { id },
      data: {
        estado: aprobar ? 'aprobado' : 'rechazado',
        respuesta: comentario || null,
        resueltoEn: new Date(),
      },
    });

    // Avisar al solicitante del desenlace, para que sepa si ya puede continuar.
    const propietario = await this.nombreDe(row.propietarioId, user);
    await this.avisar({
      usuarioIds: [row.solicitanteId],
      tipo: 'autorizacion_cliente_resuelta',
      titulo: aprobar ? 'Autorizacion aprobada' : 'Autorizacion rechazada',
      mensaje: aprobar
        ? `${propietario} autorizo tu solicitud para el cliente ${row.cliente?.nombre || ''}. Ya puedes generar ${this.etiquetaModulo(row.modulo)}.${comentario ? ` Comentario: ${comentario}` : ''}`
        : `${propietario} rechazo tu solicitud para el cliente ${row.cliente?.nombre || ''}.${comentario ? ` Motivo: ${comentario}` : ''}`,
      payload: {
        autorizacionClienteId: row.id,
        prioridad: aprobar ? 'normal' : 'alta',
        modulo: row.modulo,
        clienteId: row.clienteId,
        cliente: row.cliente?.nombre || '',
        aprobado: aprobar,
        propietarioId: row.propietarioId,
        propietario,
        comentario,
      },
    });

    return actualizada;
  }
}
