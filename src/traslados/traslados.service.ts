import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { assertBodegaAccess, getAllowedBodegaIds } from "../bodegas/bodega-access";
import { CorrelativosService } from "../correlativos/correlativos.service";

@Injectable()
export class TrasladosService {
  private notifier: NotificationService;
  private readonly trasladoInclude = {
    detalle: {
      include: {
        producto: {
          include: {
            tela: true,
            talla: true,
            color: true,
          },
        },
      },
    },
    desdeBodega: true,
    haciaBodega: true,
    solicitudTraslado: {
      include: {
        venta: true,
      },
    },
  };

  private readonly solicitudInclude = {
    venta: true,
    desdeBodega: true,
    haciaBodega: true,
    detalle: {
      include: {
        producto: {
          include: {
            tela: true,
            talla: true,
            color: true,
          },
        },
      },
    },
    traslados: true,
  };

  constructor(
    private prisma: PrismaService,
    private correlativos: CorrelativosService,
  ) {
    this.notifier = new NotificationService(prisma);
  }

  private isAdmin(user?: { rol?: string | null }) {
    return `${user?.rol || ""}`.trim().toUpperCase() === "ADMIN";
  }

  private hasPermission(user: { permisos?: string[] | null } | undefined, permission: string) {
    return Array.isArray(user?.permisos) && user.permisos.includes(permission);
  }

  private async buildTrasladoWhere(
    query: any = {},
    user?: { id?: number; rol?: string | null; permisos?: string[] | null },
  ) {
    const where: any = {};
    const desde = query.desde ? new Date(`${query.desde}T00:00:00`) : null;
    const hasta = query.hasta ? new Date(`${query.hasta}T23:59:59.999`) : null;
    if (desde || hasta) {
      where.fecha = {
        ...(desde ? { gte: desde } : {}),
        ...(hasta ? { lte: hasta } : {}),
      };
    }

    const desdeBodegaId = Number(query.desdeBodegaId || 0);
    const haciaBodegaId = Number(query.haciaBodegaId || 0);
    if (desdeBodegaId > 0) where.desdeBodegaId = desdeBodegaId;
    if (haciaBodegaId > 0) where.haciaBodegaId = haciaBodegaId;

    const responsable = `${query.responsable || ""}`.trim();
    if (responsable) where.responsable = { contains: responsable };

    const baseWhere = this.isAdmin(user) || this.hasPermission(user, "sistema.multi-tienda") ? {} : await this.buildBodegaAccessWhere(user);
    if (Object.keys(baseWhere).length) {
      where.AND = [...(where.AND || []), baseWhere];
    }

    return where;
  }

  private async buildBodegaAccessWhere(user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    if (this.isAdmin(user) || this.hasPermission(user, "sistema.multi-tienda")) return {};

    const allowedBodegas = await getAllowedBodegaIds(this.prisma, user, "traslados");
    if (allowedBodegas === null) return {};
    if (!allowedBodegas.length) return { id: -1 };

    return {
      OR: [{ desdeBodegaId: { in: allowedBodegas } }, { haciaBodegaId: { in: allowedBodegas } }],
    };
  }

  private async moverStock(
    desdeBodegaId: number,
    haciaBodegaId: number,
    detalle: Array<{ productoId: number; cantidad: number }>,
    referencia: string,
  ) {
    for (const item of detalle) {
      const productoId = Number(item.productoId);
      const cantidad = Number(item.cantidad || 0);
      if (!productoId || cantidad <= 0) {
        throw new BadRequestException("El detalle del traslado contiene productos o cantidades invalidas");
      }

      const invOrigen = await this.prisma.inventario.findUnique({
        where: {
          bodegaId_productoId: {
            bodegaId: desdeBodegaId,
            productoId,
          },
        },
      });

      if (!invOrigen || invOrigen.stock < cantidad) {
        const disponible = invOrigen?.stock ?? 0;
        throw new BadRequestException(
          `Stock insuficiente en bodega origen para producto ${productoId}. Disponible: ${disponible}`,
        );
      }

      await this.prisma.inventario.update({
        where: {
          bodegaId_productoId: {
            bodegaId: desdeBodegaId,
            productoId,
          },
        },
        data: { stock: { decrement: cantidad } },
      });

      await this.prisma.inventario.upsert({
        where: {
          bodegaId_productoId: {
            bodegaId: haciaBodegaId,
            productoId,
          },
        },
        update: { stock: { increment: cantidad } },
        create: {
          bodegaId: haciaBodegaId,
          productoId,
          stock: cantidad,
        },
      });

      await this.prisma.movInventario.createMany({
        data: [
          {
            bodegaId: desdeBodegaId,
            productoId,
            tipo: "traslado_salida",
            cantidad,
            referencia,
          },
          {
            bodegaId: haciaBodegaId,
            productoId,
            tipo: "traslado_entrada",
            cantidad,
            referencia,
          },
        ],
      });

      const invCheck = await this.prisma.inventario.findUnique({
        where: {
          bodegaId_productoId: { bodegaId: desdeBodegaId, productoId },
        },
      });
      const minimo = await this.prisma.stockMinimoBodegaProducto.findUnique({
        where: { bodegaId_productoId: { bodegaId: desdeBodegaId, productoId } },
      });
      const threshold = Number(minimo?.minimo ?? process.env.STOCK_ALERT_THRESHOLD ?? 5);
      if (invCheck && invCheck.stock < threshold) {
        await this.notifier.notifyLowStock([{ bodegaId: desdeBodegaId, productoId }]);
      }
    }
  }

  async crearTraslado(data: any, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    await assertBodegaAccess(this.prisma, user, Number(data.desdeBodegaId), "traslados");
    await assertBodegaAccess(this.prisma, user, Number(data.haciaBodegaId), "traslados");
    const detalle = Array.isArray(data.detalle) ? data.detalle : [];
    if (!detalle.length) throw new BadRequestException("Agrega al menos un articulo al traslado");
    const estado = `${data.estado || "RECIBIDO"}`.trim().toUpperCase();
    const folioResp = user?.id
      ? await this.correlativos.generarUsuarioOperacionCorrelativo(Number(user.id), "traslado")
      : null;

    const traslado = await this.prisma.traslado.create({
      data: {
        folio: folioResp?.correlativo || null,
        desdeBodegaId: data.desdeBodegaId,
        haciaBodegaId: data.haciaBodegaId,
        observaciones: data.observaciones || null,
        responsable: data.responsable || null,
        estado,
        solicitudTrasladoId: data.solicitudTrasladoId ? Number(data.solicitudTrasladoId) : null,
      },
    });

    for (const item of detalle) {
      await this.prisma.detalleTraslado.create({
        data: {
          trasladoId: traslado.id,
          productoId: Number(item.productoId),
          cantidad: Number(item.cantidad || 0),
        },
      });
    }

    if (estado === "RECIBIDO") {
      await this.moverStock(
        Number(data.desdeBodegaId),
        Number(data.haciaBodegaId),
        detalle,
        traslado.folio || `Traslado #${traslado.id}`,
      );
    }

    return this.prisma.traslado.findUnique({
      where: { id: traslado.id },
      include: this.trasladoInclude,
    });
  }

  async findAll(query: any = {}, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    return this.prisma.traslado.findMany({
      where: await this.buildTrasladoWhere(query, user),
      include: this.trasladoInclude,
      orderBy: { fecha: "desc" },
    });
  }

  async findSolicitudes(query: any = {}, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const where: any = {};
    const desde = query.desde ? new Date(`${query.desde}T00:00:00`) : null;
    const hasta = query.hasta ? new Date(`${query.hasta}T23:59:59.999`) : null;
    if (desde || hasta) {
      where.fecha = {
        ...(desde ? { gte: desde } : {}),
        ...(hasta ? { lte: hasta } : {}),
      };
    }
    if (query.estado) where.estado = `${query.estado}`.trim().toUpperCase();
    const desdeBodegaId = Number(query.desdeBodegaId || 0);
    const haciaBodegaId = Number(query.haciaBodegaId || 0);
    if (desdeBodegaId > 0) where.desdeBodegaId = desdeBodegaId;
    if (haciaBodegaId > 0) where.haciaBodegaId = haciaBodegaId;

    const accessWhere = await this.buildBodegaAccessWhere(user);
    if (Object.keys(accessWhere).length) {
      where.AND = [...(where.AND || []), accessWhere];
    }

    return this.prisma.solicitudTraslado.findMany({
      where,
      include: this.solicitudInclude,
      orderBy: { fecha: "desc" },
    });
  }

  async actualizarSolicitudEstado(
    id: number,
    data: any,
    user?: { id?: number; rol?: string | null; permisos?: string[] | null },
  ) {
    const estado = `${data?.estado || ""}`.trim().toUpperCase();
    const estadosPermitidos = new Set(["PENDIENTE_APROBACION", "PENDIENTE", "PREPARADO", "EN_TRANSITO", "RECIBIDO_PARCIAL", "RECIBIDO", "CANCELADO"]);
    if (!estadosPermitidos.has(estado)) {
      throw new BadRequestException("Estado de solicitud invalido");
    }

    const solicitud = await this.prisma.solicitudTraslado.findUnique({
      where: { id },
      include: this.solicitudInclude,
    });
    if (!solicitud) throw new BadRequestException("Solicitud de traslado no encontrada");
    await assertBodegaAccess(this.prisma, user, solicitud.desdeBodegaId, "traslados");
    await assertBodegaAccess(this.prisma, user, solicitud.haciaBodegaId, "traslados");

    if (solicitud.estado === "RECIBIDO" && estado === "RECIBIDO") {
      return solicitud;
    }

    if (estado === "RECIBIDO") {
      return this.recibirSolicitudParcial(id, {
        responsable: data?.responsable,
        observaciones: data?.observaciones,
        detalle: solicitud.detalle
          .map((item: any) => ({
            detalleId: item.id,
            cantidad: Math.max(0, Number(item.cantidad || 0) - Number(item.cantidadRecibida || 0)),
          }))
          .filter((item: any) => item.cantidad > 0),
      }, user);
    }

    if (estado === "CANCELADO") {
      await this.prisma.detalleVenta.updateMany({
        where: { solicitudTrasladoId: solicitud.id },
        data: { trasladoEstado: "CANCELADO" },
      });
    } else {
      await this.prisma.detalleVenta.updateMany({
        where: { solicitudTrasladoId: solicitud.id },
        data: { trasladoEstado: estado },
      });
    }

    const usuario = `${(user as any)?.usuario || (user as any)?.nombre || user?.id || ""}`.trim();
    return this.prisma.solicitudTraslado.update({
      where: { id },
      data: {
        estado,
        observaciones: data?.observaciones ?? solicitud.observaciones,
        ...(estado === "PENDIENTE" && solicitud.estado === "PENDIENTE_APROBACION"
          ? { aprobadoPor: usuario || null, aprobadoEn: new Date() }
          : {}),
      },
      include: this.solicitudInclude,
    });
  }

  async recibirSolicitudParcial(
    id: number,
    data: any,
    user?: { id?: number; rol?: string | null; permisos?: string[] | null },
  ) {
    const solicitud = await this.prisma.solicitudTraslado.findUnique({
      where: { id },
      include: this.solicitudInclude,
    });
    if (!solicitud) throw new BadRequestException("Solicitud de traslado no encontrada");
    if (solicitud.estado === "CANCELADO") throw new BadRequestException("No se puede recibir una solicitud cancelada");
    if (solicitud.estado === "RECIBIDO") throw new BadRequestException("La solicitud ya fue recibida completamente");
    await assertBodegaAccess(this.prisma, user, solicitud.desdeBodegaId, "traslados");
    await assertBodegaAccess(this.prisma, user, solicitud.haciaBodegaId, "traslados");

    const detalleInput = Array.isArray(data?.detalle) ? data.detalle : [];
    if (!detalleInput.length) throw new BadRequestException("Ingresa al menos una cantidad a recibir");

    const detalleMap = new Map((solicitud.detalle as any[]).map((item) => [Number(item.id), item]));
    const detalleRecibido: Array<{ detalleId: number; productoId: number; cantidad: number }> = [];
    for (const row of detalleInput) {
      const detalleId = Number(row.detalleId || row.id || 0);
      const cantidad = Number(row.cantidad || row.cantidadRecibida || 0);
      if (!detalleId || cantidad <= 0) continue;
      const detalle = detalleMap.get(detalleId);
      if (!detalle) throw new BadRequestException("Una linea no pertenece a la solicitud");
      const pendiente = Number(detalle.cantidad || 0) - Number(detalle.cantidadRecibida || 0);
      if (cantidad > pendiente) {
        throw new BadRequestException(
          `La cantidad recibida de producto ${detalle.productoId} supera lo pendiente (${pendiente})`,
        );
      }
      detalleRecibido.push({ detalleId, productoId: Number(detalle.productoId), cantidad });
    }
    if (!detalleRecibido.length) throw new BadRequestException("No hay cantidades pendientes para recibir");

    const folioResp = user?.id
      ? await this.correlativos.generarUsuarioOperacionCorrelativo(Number(user.id), "traslado")
      : null;
    const traslado = await this.prisma.traslado.create({
      data: {
        folio: folioResp?.correlativo || null,
        desdeBodegaId: solicitud.desdeBodegaId,
        haciaBodegaId: solicitud.haciaBodegaId,
        responsable: data?.responsable || solicitud.responsable,
        observaciones:
          data?.observaciones ||
          solicitud.observaciones ||
          `Recepcion parcial de ${solicitud.folio || `solicitud #${solicitud.id}`}`,
        solicitudTrasladoId: solicitud.id,
        estado: "RECIBIDO",
      },
    });

    for (const item of detalleRecibido) {
      await this.prisma.detalleTraslado.create({
        data: {
          trasladoId: traslado.id,
          productoId: item.productoId,
          cantidad: item.cantidad,
        },
      });
    }

    if (!solicitud.ventaId) {
      await this.moverStock(
        solicitud.desdeBodegaId,
        solicitud.haciaBodegaId,
        detalleRecibido.map((item) => ({ productoId: item.productoId, cantidad: item.cantidad })),
        traslado.folio || `Recepcion solicitud #${solicitud.id}`,
      );
    }

    for (const item of detalleRecibido) {
      const detalleOriginal = detalleMap.get(item.detalleId);
      const nuevaRecibida = Number(detalleOriginal.cantidadRecibida || 0) + item.cantidad;
      const estadoDetalle = nuevaRecibida >= Number(detalleOriginal.cantidad || 0) ? "RECIBIDO" : "PARCIAL";
      await this.prisma.detalleSolicitudTraslado.update({
        where: { id: item.detalleId },
        data: {
          cantidadRecibida: { increment: item.cantidad },
          estado: estadoDetalle,
        },
      });
    }

    const detalleActualizado = await this.prisma.detalleSolicitudTraslado.findMany({
      where: { solicitudId: solicitud.id },
    });
    const todoRecibido = detalleActualizado.every((item) => Number(item.cantidadRecibida || 0) >= Number(item.cantidad || 0));
    const algoRecibido = detalleActualizado.some((item) => Number(item.cantidadRecibida || 0) > 0);
    const estadoSolicitud = todoRecibido ? "RECIBIDO" : algoRecibido ? "RECIBIDO_PARCIAL" : solicitud.estado;

    await this.prisma.detalleVenta.updateMany({
      where: { solicitudTrasladoId: solicitud.id },
      data: { trasladoEstado: estadoSolicitud },
    });

    return this.prisma.solicitudTraslado.update({
      where: { id: solicitud.id },
      data: {
        estado: estadoSolicitud,
        ...(todoRecibido ? { recibidoEn: new Date() } : {}),
        observaciones: data?.observaciones ?? solicitud.observaciones,
      },
      include: this.solicitudInclude,
    });
  }
}
