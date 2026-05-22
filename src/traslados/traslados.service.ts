import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { assertBodegaAccess, getAllowedBodegaIds } from "../bodegas/bodega-access";
import { CorrelativosService } from "../correlativos/correlativos.service";

@Injectable()
export class TrasladosService {
  private notifier: NotificationService;

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

  async crearTraslado(data: any, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    await assertBodegaAccess(this.prisma, user, Number(data.desdeBodegaId), "traslados");
    await assertBodegaAccess(this.prisma, user, Number(data.haciaBodegaId), "traslados");
    const folioResp = user?.id
      ? await this.correlativos.generarUsuarioOperacionCorrelativo(Number(user.id), "traslado")
      : null;
    // 1) Crear cabecera
    const traslado = await this.prisma.traslado.create({
      data: {
        folio: folioResp?.correlativo || null,
        desdeBodegaId: data.desdeBodegaId,
        haciaBodegaId: data.haciaBodegaId,
        observaciones: data.observaciones || null,
        responsable: data.responsable || null,
      },
    });

    // 2) Procesar detalle
    for (const item of data.detalle) {
      const invOrigen = await this.prisma.inventario.findUnique({
        where: {
          bodegaId_productoId: {
            bodegaId: data.desdeBodegaId,
            productoId: item.productoId,
          },
        },
      });

      if (!invOrigen || invOrigen.stock < item.cantidad) {
        const disponible = invOrigen?.stock ?? 0;
        throw new BadRequestException(
          `Stock insuficiente en bodega origen para producto ${item.productoId}. Disponible: ${disponible}`,
        );
      }

      // Guardar detalle
      await this.prisma.detalleTraslado.create({
        data: {
          trasladoId: traslado.id,
          productoId: item.productoId,
          cantidad: item.cantidad,
        },
      });

      // 3) Restar stock desde
      await this.prisma.inventario.update({
        where: {
          bodegaId_productoId: {
            bodegaId: data.desdeBodegaId,
            productoId: item.productoId,
          },
        },
        data: {
          stock: { decrement: item.cantidad },
        },
      });

      // 4) Aumentar stock hacia
      try {
        await this.prisma.inventario.update({
          where: {
            bodegaId_productoId: {
              bodegaId: data.haciaBodegaId,
              productoId: item.productoId,
            },
          },
          data: {
            stock: { increment: item.cantidad },
          },
        });
      } catch {
        // Si no existe inventario en bodega destino, crearlo
        await this.prisma.inventario.create({
          data: {
            bodegaId: data.haciaBodegaId,
            productoId: item.productoId,
            stock: item.cantidad,
          },
        });
      }

      // 5) Registrar movimiento en historial
      await this.prisma.movInventario.createMany({
        data: [
          {
            bodegaId: data.desdeBodegaId,
            productoId: item.productoId,
            tipo: "traslado_salida",
            cantidad: item.cantidad,
            referencia: traslado.folio || `Traslado #${traslado.id}`,
          },
          {
            bodegaId: data.haciaBodegaId,
            productoId: item.productoId,
            tipo: "traslado_entrada",
            cantidad: item.cantidad,
            referencia: traslado.folio || `Traslado #${traslado.id}`,
          },
        ],
      });

      // 5b) Notificación de stock bajo en origen
      const threshold = Number(process.env.STOCK_ALERT_THRESHOLD || 5);
      const invCheck = await this.prisma.inventario.findUnique({
        where: {
          bodegaId_productoId: { bodegaId: data.desdeBodegaId, productoId: item.productoId },
        },
      });
      if (invCheck && invCheck.stock < threshold) {
        await this.notifier.notifyLowStock([{ bodegaId: data.desdeBodegaId, productoId: item.productoId }]);
      }
    }

    // 6) Retornar traslado con detalle
    return this.prisma.traslado.findUnique({
      where: { id: traslado.id },
      include: {
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
      },
    });
  }

  async findAll(query: any = {}, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    return this.prisma.traslado.findMany({
      where: await this.buildTrasladoWhere(query, user),
      include: {
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
      },
      orderBy: { fecha: "desc" },
    });
  }
}
