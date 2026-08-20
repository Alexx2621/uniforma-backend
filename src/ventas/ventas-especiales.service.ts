import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AlertasService } from '../alertas/alertas.service';
import { VentasService } from './ventas.service';

/** El unico tipo de cliente al que se le puede entregar sin cobro. */
const TIPO_TRABAJADOR = 'trabajador';

type AuthUser = {
  id?: number;
  rol?: string | null;
  permisos?: string[] | null;
  usuario?: string | null;
  nombre?: string | null;
};

/**
 * Entregas de producto a trabajadores, sin cobro y con autorizacion.
 *
 * Antes esto no dejaba rastro: o se registraba una venta normal inventando un
 * monto, o el producto salia de la tienda sin quedar en ningun lado. Las dos
 * salidas ensucian el inventario o los ingresos.
 *
 * La venta se guarda como payload y **solo se crea cuando un ADMIN aprueba**,
 * igual que en las autorizaciones de pedidos. Asi el inventario no se mueve
 * mientras la solicitud espera respuesta: si se rechaza, no hay nada que
 * revertir.
 */
@Injectable()
export class VentasEspecialesService {
  constructor(
    private prisma: PrismaService,
    private ventas: VentasService,
    private alertas: AlertasService,
  ) {}

  private esAdmin(user?: AuthUser) {
    return `${user?.rol || ''}`.trim().toUpperCase() === 'ADMIN';
  }

  private async administradores() {
    const admins = await this.prisma.usuario.findMany({
      where: { activo: true, rol: { nombre: { in: ['ADMIN', 'ADMINISTRADOR'] } } },
      select: { id: true },
    });
    return admins.map((item) => item.id);
  }

  /**
   * Comprueba que el cliente exista y sea trabajador.
   *
   * Se vuelve a comprobar al aprobar, no solo al solicitar: entre una cosa y
   * otra alguien pudo cambiarle el tipo al cliente, y aprobar entonces
   * regalaria producto a un cliente comun.
   */
  private async assertClienteTrabajador(clienteId: number) {
    const cliente = await this.prisma.cliente.findUnique({
      where: { id: Number(clienteId) },
      select: { id: true, nombre: true, tipoCliente: true },
    });
    if (!cliente) throw new BadRequestException('El cliente de la solicitud ya no existe');
    if (`${cliente.tipoCliente || ''}`.trim().toLowerCase() !== TIPO_TRABAJADOR) {
      throw new BadRequestException(
        `${cliente.nombre} no esta registrado como trabajador. La venta especial solo aplica a trabajadores.`,
      );
    }
    return cliente;
  }

  /**
   * Deja la venta en valor cero.
   *
   * No se limita a validar lo que llega: reescribe los montos. Validar dejaria
   * la puerta abierta a que un payload manipulado colara precios, y esta venta
   * se excluye de los reportes de ingresos — un monto aqui desapareceria de
   * las cuentas sin que nadie lo note.
   */
  private aValorCero(data: any) {
    const detalle = Array.isArray(data?.detalle) ? data.detalle : [];
    return {
      ...data,
      detalle: detalle.map((linea: any) => ({
        ...linea,
        precioUnit: 0,
        descuento: 0,
        bordado: 0,
        subtotal: 0,
      })),
      envio: 0,
      recargo: 0,
      total: 0,
      pagos: [],
      esVentaEspecial: true,
    };
  }

  private resumen(data: any) {
    const detalle = Array.isArray(data?.detalle) ? data.detalle : [];
    const prendas = detalle.reduce((suma: number, linea: any) => suma + Number(linea?.cantidad || 0), 0);
    return `${detalle.length} linea(s), ${prendas} prenda(s)`;
  }

  async solicitar(data: any, user?: AuthUser, comentario?: string) {
    const usuarioId = Number(user?.id || 0);
    if (!usuarioId) throw new BadRequestException('No se pudo identificar al usuario solicitante');
    if (!Array.isArray(data?.detalle) || !data.detalle.length) {
      throw new BadRequestException('Agrega al menos un producto a la entrega');
    }
    if (!data?.clienteId) {
      throw new BadRequestException('Elige al trabajador que recibe el producto');
    }

    const cliente = await this.assertClienteTrabajador(Number(data.clienteId));

    const admins = await this.administradores();
    if (!admins.length) {
      throw new BadRequestException('No hay administradores activos que puedan autorizar la entrega');
    }

    const solicitud = await this.prisma.ventaEspecialAutorizacion.create({
      data: {
        solicitadoPorId: usuarioId,
        comentario: `${comentario || ''}`.trim() || null,
        payload: this.aValorCero(data),
      },
      include: { solicitadoPor: { select: { id: true, nombre: true, usuario: true } } },
    });

    const solicitante = solicitud.solicitadoPor?.nombre || solicitud.solicitadoPor?.usuario || 'Un vendedor';
    await this.alertas.crearAlertasPorUsuarios({
      usuarioIds: admins,
      tipo: 'venta_especial_autorizacion',
      titulo: 'Entrega a trabajador pendiente de autorizacion',
      mensaje: `${solicitante} solicita entregar producto sin cobro a ${cliente.nombre}. ${this.resumen(data)}.`,
      payload: {
        autorizacionVentaEspecialId: solicitud.id,
        prioridad: 'alta',
        solicitanteId: usuarioId,
        solicitante,
        cliente: cliente.nombre,
        resumen: this.resumen(data),
        comentario: `${comentario || ''}`.trim() || null,
      },
    });

    return { id: solicitud.id, estado: solicitud.estado, autorizadores: admins.length };
  }

  private async cargarPendiente(solicitudId: number) {
    const solicitud = await this.prisma.ventaEspecialAutorizacion.findUnique({
      where: { id: Number(solicitudId) },
      include: { solicitadoPor: { select: { id: true, rol: { select: { nombre: true } }, bodegaId: true } } },
    });
    if (!solicitud) throw new NotFoundException('Solicitud de entrega no encontrada');
    if (solicitud.estado !== 'pendiente') throw new BadRequestException('Esta solicitud ya fue resuelta');
    return solicitud;
  }

  async aprobar(solicitudId: number, authUser?: AuthUser, comentario?: string) {
    if (!this.esAdmin(authUser)) {
      throw new ForbiddenException('Solo un administrador puede autorizar una entrega sin cobro');
    }
    const solicitud = await this.cargarPendiente(solicitudId);
    const payload: any = solicitud.payload;

    await this.assertClienteTrabajador(Number(payload?.clienteId));

    // createVenta separa a quien se atribuye la venta (segundo argumento) de
    // quien tiene la autoridad para crearla (tercero), y aqui esa distincion
    // importa: la venta queda a nombre del vendedor que la pidio —con su folio
    // y en su historial— pero se crea con la autoridad del ADMIN que acaba de
    // aprobarla.
    //
    // Pasar al vendedor como autoridad hacia que la regla de cartera de
    // clientes volviera a pedir permiso del dueño del cliente, y la solicitud
    // moria en la aprobacion: un ADMIN ya habia autorizado la entrega y aun
    // asi no podia completarse.
    const venta: any = await this.ventas.createVenta(
      // Se vuelve a poner en cero por si el payload guardado fue manipulado.
      this.aValorCero(payload),
      solicitud.solicitadoPorId,
      { id: Number(authUser?.id || 0) || undefined, rol: 'ADMIN', permisos: [] },
    );

    await this.prisma.ventaEspecialAutorizacion.update({
      where: { id: solicitud.id },
      data: {
        estado: 'aprobado',
        respuestaComentario: `${comentario || ''}`.trim() || null,
        autorizadoPorId: Number(authUser?.id || 0) || null,
        ventaId: Number(venta?.id || 0) || null,
        autorizadoEn: new Date(),
      },
    });

    await this.alertas.crearAlertasPorUsuarios({
      usuarioIds: [solicitud.solicitadoPorId],
      tipo: 'venta_especial_autorizacion_resuelta',
      titulo: 'Entrega autorizada',
      mensaje: `Tu solicitud fue autorizada y se registro la entrega ${venta?.folio || `#${venta?.id}`}.`,
      payload: {
        autorizacionVentaEspecialId: solicitud.id,
        ventaId: venta?.id,
        estado: 'aprobado',
        prioridad: 'normal',
      },
    });

    return { id: solicitud.id, estado: 'aprobado', ventaId: venta?.id, folio: venta?.folio };
  }

  async rechazar(solicitudId: number, authUser?: AuthUser, comentario?: string) {
    if (!this.esAdmin(authUser)) {
      throw new ForbiddenException('Solo un administrador puede resolver una entrega sin cobro');
    }
    const solicitud = await this.cargarPendiente(solicitudId);

    await this.prisma.ventaEspecialAutorizacion.update({
      where: { id: solicitud.id },
      data: {
        estado: 'rechazado',
        respuestaComentario: `${comentario || ''}`.trim() || null,
        autorizadoPorId: Number(authUser?.id || 0) || null,
        autorizadoEn: new Date(),
      },
    });

    await this.alertas.crearAlertasPorUsuarios({
      usuarioIds: [solicitud.solicitadoPorId],
      tipo: 'venta_especial_autorizacion_resuelta',
      titulo: 'Entrega rechazada',
      mensaje: `Tu solicitud de entrega sin cobro fue rechazada.${
        `${comentario || ''}`.trim() ? ` Motivo: ${`${comentario}`.trim()}` : ''
      }`,
      payload: { autorizacionVentaEspecialId: solicitud.id, estado: 'rechazado', prioridad: 'normal' },
    });

    return { id: solicitud.id, estado: 'rechazado' };
  }
}
