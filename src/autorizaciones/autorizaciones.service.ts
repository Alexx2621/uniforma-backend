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
      this.hasPermission(user, 'postventa.manage')
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
      pedidos.forEach((item) => {
        const resumen = this.pedidoResumen(item.payload);
        const tipoSolicitud = this.tipoSolicitudPedido(item);
        rows.push({
          id: `pedido-${item.id}`,
          sourceId: item.id,
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

    const stats = rows.reduce(
      (acc, row) => {
        acc.total += 1;
        acc[row.tipo] = (acc[row.tipo] || 0) + 1;
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
