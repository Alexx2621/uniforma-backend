import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type AuthUser = { id?: number; rol?: string | null; permisos?: string[] | null };

@Injectable()
export class AutorizacionesService {
  constructor(private prisma: PrismaService) {}

  private isAdmin(user?: AuthUser) {
    return `${user?.rol || ''}`.trim().toUpperCase() === 'ADMIN';
  }

  private hasPermission(user: AuthUser | undefined, permission: string) {
    return this.isAdmin(user) || (Array.isArray(user?.permisos) && user.permisos.includes(permission));
  }

  private assertCanView(user?: AuthUser) {
    if (
      this.hasPermission(user, 'autorizaciones.view') ||
      this.hasPermission(user, 'produccion.autorizar-pedidos') ||
      this.hasPermission(user, 'inventario.trasladar') ||
      this.hasPermission(user, 'postventa.manage') ||
      this.hasPermission(user, 'correcciones.manage')
    ) {
      return;
    }
    throw new ForbiddenException('No tienes permisos para ver autorizaciones');
  }

  private pedidoResumen(payload: any) {
    const detalle = Array.isArray(payload?.detalle) ? payload.detalle : [];
    const cliente = payload?.clienteNombre || payload?.cliente || payload?.nombreCliente || 'Cliente no definido';
    const total = Number(payload?.totalEstimado || payload?.total || 0);
    return {
      cliente,
      total,
      lineas: detalle.length,
      articulos: detalle.reduce((sum: number, item: any) => sum + Number(item?.cantidad || 0), 0),
    };
  }

  private tipoSolicitudPedido(item: any) {
    return `${item?.tipoSolicitud || item?.payload?.tipoSolicitud || item?.payload?.__tipoSolicitud || 'creacion'}`
      .trim()
      .toLowerCase();
  }

  private formatPedidoAutorizacionHistorial(item: any) {
    const tipoSolicitud = this.tipoSolicitudPedido(item);
    return {
      id: item.id,
      estado: item.estado,
      tipoSolicitud,
      fecha: item.creadoEn,
      autorizadoEn: item.autorizadoEn,
      solicitadoPor: item.solicitadoPor?.nombre || item.solicitadoPor?.usuario || 'N/D',
      autorizadoPor: item.autorizadoPor?.nombre || item.autorizadoPor?.usuario || null,
      comentario: item.comentario,
      respuestaComentario: item.respuestaComentario,
    };
  }

  async listar(query: { estado?: string; tipo?: string } = {}, user?: AuthUser) {
    this.assertCanView(user);
    const estado = `${query.estado || 'pendiente'}`.trim().toLowerCase();
    const tipo = `${query.tipo || ''}`.trim();
    const rows: any[] = [];

    if (!tipo || tipo === 'pedido') {
      const pedidos = await this.prisma.pedidoProduccionAutorizacion.findMany({
        where: estado === 'todos' ? {} : { estado },
        include: {
          solicitadoPor: { select: { id: true, nombre: true, usuario: true } },
          autorizadoPor: { select: { id: true, nombre: true, usuario: true } },
          pedido: { select: { id: true, folio: true } },
        },
        orderBy: { creadoEn: 'desc' },
        take: 100,
      });
      const pedidoIds = Array.from(
        new Set(pedidos.map((item) => Number(item.pedidoId || 0)).filter((id) => Number.isFinite(id) && id > 0)),
      );
      const historialPorPedido = new Map<number, any[]>();
      if (pedidoIds.length) {
        const historial = await this.prisma.pedidoProduccionAutorizacion.findMany({
          where: { pedidoId: { in: pedidoIds } },
          include: {
            solicitadoPor: { select: { id: true, nombre: true, usuario: true } },
            autorizadoPor: { select: { id: true, nombre: true, usuario: true } },
          },
          orderBy: { creadoEn: 'desc' },
          take: 300,
        });
        historial.forEach((item) => {
          if (!item.pedidoId) return;
          const group = historialPorPedido.get(item.pedidoId) || [];
          group.push(this.formatPedidoAutorizacionHistorial(item));
          historialPorPedido.set(item.pedidoId, group);
        });
      }
      pedidos.forEach((item) => {
        const resumen = this.pedidoResumen(item.payload);
        const tipoSolicitud = this.tipoSolicitudPedido(item);
        rows.push({
          id: `pedido-${item.id}`,
          sourceId: item.id,
          pedidoId: item.pedidoId,
          tipo: 'pedido',
          subtipo: tipoSolicitud,
          titulo: tipoSolicitud === 'edicion' ? 'Edicion de pedido' : 'Pedido de produccion',
          referencia: item.pedido?.folio || `Solicitud #${item.id}`,
          estado: item.estado,
          fecha: item.creadoEn,
          solicitadoPor: item.solicitadoPor?.nombre || item.solicitadoPor?.usuario || 'N/D',
          autorizadoPor: item.autorizadoPor?.nombre || item.autorizadoPor?.usuario || null,
          total: resumen.total,
          resumen: `${resumen.cliente} | ${resumen.lineas} lineas | ${resumen.articulos} articulos`,
          comentario: item.comentario,
          respuestaComentario: item.respuestaComentario,
          payload: item.payload,
          historial: item.pedidoId ? historialPorPedido.get(item.pedidoId) || [] : [],
          path: item.pedido?.id ? `/produccion/${item.pedido.id}` : '/produccion',
        });
      });
    }

    if (!tipo || tipo === 'traslado') {
      const trasladoEstado = estado === 'pendiente' ? 'PENDIENTE_APROBACION' : estado === 'todos' ? undefined : estado.toUpperCase();
      const traslados = await this.prisma.solicitudTraslado.findMany({
        where: trasladoEstado ? { estado: trasladoEstado } : {},
        include: {
          desdeBodega: true,
          haciaBodega: true,
          venta: { select: { id: true, folio: true, clienteNombre: true, total: true } },
          detalle: { include: { producto: { include: { tela: true, talla: true, color: true } } } },
        },
        orderBy: { fecha: 'desc' },
        take: 100,
      });
      traslados.forEach((item) => {
        const articulos = item.detalle.reduce((sum, det) => sum + Number(det.cantidad || 0), 0);
        rows.push({
          id: `traslado-${item.id}`,
          sourceId: item.id,
          tipo: 'traslado',
          titulo: 'Traslado requerido',
          referencia: item.folio || `ST-${item.id}`,
          estado: item.estado,
          fecha: item.fecha,
          solicitadoPor: item.responsable || 'Sistema',
          autorizadoPor: item.aprobadoPor || null,
          total: Number(item.venta?.total || 0),
          resumen: `${item.desdeBodega?.nombre || 'Origen'} -> ${item.haciaBodega?.nombre || 'Destino'} | ${item.detalle.length} lineas | ${articulos} articulos`,
          comentario: item.observaciones,
          payload: {
            venta: item.venta,
            detalle: item.detalle,
          },
          path: '/inventario/traslados',
        });
      });
    }

    if (!tipo || tipo === 'postventa') {
      const postventaEstado = estado === 'pendiente' ? 'en_revision' : estado === 'todos' ? undefined : estado;
      const postventa = await this.prisma.cambioDevolucion.findMany({
        where: postventaEstado ? { estado: postventaEstado } : {},
        include: { usuario: { select: { id: true, nombre: true, usuario: true } } },
        orderBy: { fecha: 'desc' },
        take: 100,
      });
      postventa.forEach((item) => {
        rows.push({
          id: `postventa-${item.id}`,
          sourceId: item.id,
          tipo: 'postventa',
          titulo: item.tipo === 'devolucion' ? 'Devolucion en revision' : 'Cambio en revision',
          referencia: item.folio,
          estado: item.estado,
          fecha: item.fecha,
          solicitadoPor: item.usuario?.nombre || item.usuario?.usuario || 'N/D',
          autorizadoPor: null,
          total: Number(item.monto || 0),
          resumen: `${item.clienteNombre} | ${item.motivo}`,
          comentario: item.observaciones,
          payload: item.detalle,
          path: item.tipo === 'devolucion' ? '/devoluciones' : '/cambios',
        });
      });
    }

    if (!tipo || tipo === 'ajuste_pago') {
      const ajusteEstado = estado === 'pendiente'
        ? { in: ['pendiente', 'pendiente_segunda_aprobacion'] }
        : estado === 'todos' ? undefined : estado;
      const ajustes = await this.prisma.ajustePagoPedido.findMany({
        where: ajusteEstado ? { estado: ajusteEstado } : {},
        include: {
          pedido: { select: { id: true, folio: true, clienteNombre: true } },
          pagoOriginal: { select: { id: true, monto: true, fecha: true, metodo: true } },
          solicitadoPor: { select: { id: true, nombre: true, usuario: true } },
          aprobadoPor: { select: { id: true, nombre: true, usuario: true } },
          segundaAprobacionPor: { select: { id: true, nombre: true, usuario: true } },
        },
        orderBy: { creadoEn: 'desc' },
        take: 100,
      });
      ajustes.forEach((item) => {
        rows.push({
          id: `ajuste-pago-${item.id}`,
          sourceId: item.id,
          pedidoId: item.pedidoId,
          tipo: 'ajuste_pago',
          titulo: item.aprobacionesRequeridas > 1 ? 'Ajuste de pago con doble aprobacion' : 'Ajuste de pago historico',
          referencia: item.folio,
          estado: item.estado,
          fecha: item.creadoEn,
          solicitadoPor: item.solicitadoPor?.nombre || item.solicitadoPor?.usuario || 'N/D',
          autorizadoPor: item.segundaAprobacionPor?.nombre || item.aprobadoPor?.nombre || null,
          total: Number(item.diferencia || 0),
          resumen: `${item.pedido?.folio || `Pedido ${item.pedidoId}`} | ${item.pedido?.clienteNombre || 'Cliente'} | registrado Q ${Number(item.montoRegistrado).toFixed(2)} -> correcto Q ${Number(item.montoCorrecto).toFixed(2)}`,
          comentario: item.motivo,
          respuestaComentario: item.respuesta,
          payload: {
            pagoOriginalId: item.pagoOriginalId,
            montoRegistrado: item.montoRegistrado,
            montoCorrecto: item.montoCorrecto,
            diferencia: item.diferencia,
            fechaPagoReal: item.fechaPagoReal,
            metodo: item.metodo,
            referenciaPago: item.referencia,
            banco: item.banco,
            ubicacion: item.ubicacion,
            evidenciaReferencia: item.evidenciaReferencia,
            aprobacionesRequeridas: item.aprobacionesRequeridas,
            primeraAprobacion: item.aprobadoPor?.nombre || item.aprobadoPor?.usuario || null,
            segundaAprobacion: item.segundaAprobacionPor?.nombre || item.segundaAprobacionPor?.usuario || null,
            cierreOriginalId: item.cierreOriginalId,
            cierreRectificadoId: item.cierreRectificadoId,
          },
          path: `/pagos/recibidos?pedido=${item.pedidoId}`,
        });
      });
    }

    const stats = rows.reduce(
      (acc, row) => {
        acc.total += 1;
        acc[row.tipo] = (acc[row.tipo] || 0) + 1;
        acc[row.estado] = (acc[row.estado] || 0) + 1;
        return acc;
      },
      { total: 0 } as Record<string, number>,
    );

    return {
      stats,
      rows: rows.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()),
    };
  }
}
