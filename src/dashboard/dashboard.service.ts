import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type DashboardUser = {
  id?: number;
  usuario?: string | null;
  nombre?: string | null;
  rol?: string | null;
  permisos?: string[] | null;
  bodegaId?: number | null;
};

type DashboardQuery = {
  desde?: string;
  hasta?: string;
  bodegaId?: string | number;
  usuarioId?: string | number;
};

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async obtenerPreferencias(user: DashboardUser) {
    const usuarioId = this.requireUserId(user);
    const saved = await this.prisma.preferenciaDashboard.findUnique({
      where: { usuarioId },
      select: { version: true, data: true, actualizadoEn: true },
    });

    return {
      preferences: saved?.data ?? null,
      version: saved?.version ?? 2,
      updatedAt: saved?.actualizadoEn?.toISOString() ?? null,
    };
  }

  async guardarPreferencias(user: DashboardUser, body: unknown) {
    const usuarioId = this.requireUserId(user);
    const preferences = this.normalizePreferences(body);
    const serialized = JSON.stringify(preferences);
    if (Buffer.byteLength(serialized, 'utf8') > 50_000) {
      throw new BadRequestException('La configuración del dashboard excede el tamaño permitido');
    }

    const saved = await this.prisma.preferenciaDashboard.upsert({
      where: { usuarioId },
      create: { usuarioId, version: 2, data: preferences as Prisma.InputJsonValue },
      update: { version: 2, data: preferences as Prisma.InputJsonValue },
      select: { version: true, data: true, actualizadoEn: true },
    });

    return {
      preferences: saved.data,
      version: saved.version,
      updatedAt: saved.actualizadoEn.toISOString(),
    };
  }

  private requireUserId(user: DashboardUser) {
    const usuarioId = Number(user?.id || 0);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      throw new UnauthorizedException('No se pudo identificar al usuario');
    }
    return usuarioId;
  }

  private normalizePreferences(body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('La configuración del dashboard no es válida');
    }

    const input = body as Record<string, unknown>;
    if (input.version !== 2) {
      throw new BadRequestException('La versión de configuración no es compatible');
    }

    const order = this.normalizeWidgetIds(input.order, 'orden');
    const hidden = this.normalizeWidgetIds(input.hidden, 'widgets ocultos');
    if (!input.layouts || typeof input.layouts !== 'object' || Array.isArray(input.layouts)) {
      throw new BadRequestException('La distribución de widgets no es válida');
    }

    const layoutEntries = Object.entries(input.layouts as Record<string, unknown>);
    if (layoutEntries.length > 100) {
      throw new BadRequestException('La configuración contiene demasiados widgets');
    }

    const layouts: Record<string, { columns: number; height?: number }> = {};
    for (const [widgetId, rawLayout] of layoutEntries) {
      this.ensureWidgetId(widgetId);
      if (!rawLayout || typeof rawLayout !== 'object' || Array.isArray(rawLayout)) {
        throw new BadRequestException(`La distribución de ${widgetId} no es válida`);
      }

      const layout = rawLayout as Record<string, unknown>;
      const columns = Number(layout.columns);
      if (!Number.isInteger(columns) || columns < 3 || columns > 12) {
        throw new BadRequestException(`El ancho de ${widgetId} no es válido`);
      }

      const normalizedLayout: { columns: number; height?: number } = { columns };
      if (layout.height !== undefined && layout.height !== null) {
        const height = Number(layout.height);
        if (!Number.isInteger(height) || height < 100 || height > 2_000) {
          throw new BadRequestException(`La altura de ${widgetId} no es válida`);
        }
        normalizedLayout.height = height;
      }
      layouts[widgetId] = normalizedLayout;
    }

    return { version: 2 as const, order, hidden, layouts };
  }

  private normalizeWidgetIds(value: unknown, field: string) {
    if (!Array.isArray(value) || value.length > 100) {
      throw new BadRequestException(`El campo ${field} no es válido`);
    }

    const unique = new Set<string>();
    value.forEach((item) => {
      if (typeof item !== 'string') {
        throw new BadRequestException(`El campo ${field} contiene un widget no válido`);
      }
      this.ensureWidgetId(item);
      unique.add(item);
    });
    return Array.from(unique);
  }

  private ensureWidgetId(widgetId: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(widgetId)) {
      throw new BadRequestException('El identificador de widget no es válido');
    }
  }

  async resumen(user: DashboardUser, query: DashboardQuery) {
    const { desde, hasta } = this.getDateRange(query);
    const usuarioId = this.toPositiveNumber(query.usuarioId);
    const bodegaId = this.toPositiveNumber(query.bodegaId);
    const currentUser = user?.id ? await this.getCurrentUser(user.id) : null;
    const canViewAll = this.canViewAll(user);
    const effectiveUsuarioId = canViewAll ? usuarioId : user?.id;
    const effectiveBodegaId = canViewAll ? bodegaId : bodegaId || user?.bodegaId || currentUser?.bodegaId || undefined;
    const vendedorNombres = await this.getUsuarioNames(effectiveUsuarioId, currentUser, user);

    const ventasWhere = this.buildVentasWhere(desde, hasta, effectiveBodegaId, effectiveUsuarioId, vendedorNombres);
    const ventasHoyWhere = this.buildVentasWhere(
      this.startOfDay(new Date()),
      this.endOfDay(new Date()),
      effectiveBodegaId,
      effectiveUsuarioId,
      vendedorNombres,
    );
    const pedidosWhere = this.buildPedidosWhere(desde, hasta, effectiveBodegaId, effectiveUsuarioId, currentUser, user);
    const postventaWhere = this.buildPostventaWhere(desde, hasta, effectiveUsuarioId);

    const [ventasRango, ventasHoy, pedidos, postventa, inventarioBajo, ventasPorDia] = await Promise.all([
      this.prisma.venta.aggregate({
        where: ventasWhere,
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.venta.aggregate({
        where: ventasHoyWhere,
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.pedidoProduccion.findMany({
        where: pedidosWhere,
        select: {
          id: true,
          estado: true,
          fecha: true,
          totalEstimado: true,
          anticipo: true,
          saldoPendiente: true,
          postventaCobro: true,
        },
        orderBy: { fecha: 'desc' },
        take: 500,
      }),
      this.prisma.cambioDevolucion.aggregate({
        where: postventaWhere,
        _sum: { monto: true },
        _count: { _all: true },
      }),
      this.getInventarioBajo(effectiveBodegaId),
      this.getVentasPorDia(ventasWhere),
    ]);

    const pedidosAbiertos = pedidos.filter((pedido) => !this.isPedidoCerrado(pedido.estado));
    const pedidosSaldo = pedidos.filter((pedido) => this.hasPendingBalance(pedido.saldoPendiente));

    return {
      checkedAt: new Date().toISOString(),
      filtros: {
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
        bodegaId: effectiveBodegaId || null,
        usuarioId: effectiveUsuarioId || null,
        alcance: canViewAll ? 'global' : 'usuario',
      },
      ventas: {
        totalRango: Number(ventasRango._sum.total || 0),
        cantidadRango: Number(ventasRango._count._all || 0),
        totalHoy: Number(ventasHoy._sum.total || 0),
        cantidadHoy: Number(ventasHoy._count._all || 0),
        porDia: ventasPorDia,
      },
      pedidos: {
        cantidadRango: pedidos.length,
        abiertos: pedidosAbiertos.length,
        conSaldo: pedidosSaldo.length,
        saldoPendiente: this.roundMoney(pedidosSaldo.reduce((sum, pedido) => sum + this.roundMoney(pedido.saldoPendiente), 0)),
        totalRango: pedidos.reduce((sum, pedido) => sum + Number(pedido.totalEstimado || 0), 0),
        anticipos: pedidos.reduce((sum, pedido) => sum + Number(pedido.anticipo || 0), 0),
      },
      postventa: {
        cantidadRango: Number(postventa._count._all || 0),
        montoRango: Number(postventa._sum.monto || 0),
      },
      inventario: {
        bajoMinimo: inventarioBajo,
      },
    };
  }

  private getDateRange(query: DashboardQuery) {
    const hasta = query.hasta ? new Date(`${query.hasta}T23:59:59.999`) : this.endOfDay(new Date());
    const desde = query.desde ? new Date(`${query.desde}T00:00:00.000`) : new Date(hasta);
    if (!query.desde) desde.setDate(desde.getDate() - 29);
    return {
      desde: this.startOfDay(Number.isNaN(desde.getTime()) ? new Date() : desde),
      hasta: this.endOfDay(Number.isNaN(hasta.getTime()) ? new Date() : hasta),
    };
  }

  private buildVentasWhere(
    desde: Date,
    hasta: Date,
    bodegaId?: number,
    usuarioId?: number,
    vendedorNombres: string[] = [],
  ) {
    const and: any[] = [{ fecha: { gte: desde, lte: hasta } }];
    if (bodegaId) and.push({ bodegaId });
    if (usuarioId && vendedorNombres.length) {
      and.push({
        OR: vendedorNombres.map((nombre) => ({ vendedor: { contains: nombre } })),
      });
    }
    return { AND: and };
  }

  private buildPedidosWhere(
    desde: Date,
    hasta: Date,
    bodegaId?: number,
    usuarioId?: number,
    currentUser?: { nombre?: string | null; usuario?: string | null; bodegaId?: number | null } | null,
    tokenUser?: DashboardUser,
  ) {
    const and: any[] = [{ fecha: { gte: desde, lte: hasta } }];
    if (bodegaId) and.push({ bodegaId });
    if (usuarioId) {
      const names = [currentUser?.nombre, currentUser?.usuario, tokenUser?.usuario, tokenUser?.nombre].filter(Boolean) as string[];
      and.push({
        OR: [
          { usuarioId },
          ...names.map((nombre) => ({ solicitadoPor: { contains: nombre } })),
        ],
      });
    }
    return { AND: and };
  }

  private buildPostventaWhere(desde: Date, hasta: Date, usuarioId?: number) {
    const and: any[] = [{ fecha: { gte: desde, lte: hasta } }];
    if (usuarioId) and.push({ usuarioId });
    return { AND: and };
  }

  private async getVentasPorDia(where: any) {
    const ventas = await this.prisma.venta.findMany({
      where,
      select: { fecha: true, total: true },
      orderBy: { fecha: 'asc' },
      take: 1500,
    });
    const map = new Map<string, { fecha: string; total: number; cantidad: number }>();
    ventas.forEach((venta) => {
      const fecha = venta.fecha.toISOString().slice(0, 10);
      const item = map.get(fecha) || { fecha, total: 0, cantidad: 0 };
      item.total += Number(venta.total || 0);
      item.cantidad += 1;
      map.set(fecha, item);
    });
    return Array.from(map.values());
  }

  private async getInventarioBajo(bodegaId?: number) {
    const rows = await this.prisma.inventario.findMany({
      where: bodegaId ? { bodegaId } : undefined,
      select: {
        stock: true,
        producto: { select: { stockMax: true } },
      },
      take: 1000,
    });
    return rows.filter((row) => {
      const minimo = Number(row.producto?.stockMax || 0);
      return minimo > 0 && Number(row.stock || 0) <= minimo;
    }).length;
  }

  private async getCurrentUser(id: number) {
    return this.prisma.usuario.findUnique({
      where: { id },
      select: { nombre: true, usuario: true, bodegaId: true },
    });
  }

  private async getUsuarioNames(
    usuarioId?: number,
    currentUser?: { nombre?: string | null; usuario?: string | null } | null,
    tokenUser?: DashboardUser,
  ) {
    if (!usuarioId) return [];
    const usuario =
      currentUser && Number(tokenUser?.id) === Number(usuarioId)
        ? currentUser
        : await this.prisma.usuario.findUnique({
            where: { id: usuarioId },
            select: { nombre: true, usuario: true, usuarioCorrelativo: true },
          });
    return [usuario?.nombre, usuario?.usuario, (usuario as any)?.usuarioCorrelativo]
      .map((value) => `${value || ''}`.trim())
      .filter(Boolean);
  }

  private canViewAll(user: DashboardUser) {
    const permisos = new Set(user?.permisos || []);
    return (
      `${user?.rol || ''}`.toUpperCase() === 'ADMIN' ||
      permisos.has('dashboard.ver-todo') ||
      permisos.has('sistema.multi-tienda')
    );
  }

  private isPedidoCerrado(estado?: string | null) {
    const normalized = `${estado || ''}`.toLowerCase();
    return ['entregado', 'finalizado', 'completado', 'cancelado', 'anulado'].includes(normalized);
  }

  private roundMoney(value: unknown) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round((parsed + Number.EPSILON) * 100) / 100;
  }

  private hasPendingBalance(value: unknown) {
    return this.roundMoney(value) > 0;
  }

  private toPositiveNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  private startOfDay(date: Date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  private endOfDay(date: Date) {
    const copy = new Date(date);
    copy.setHours(23, 59, 59, 999);
    return copy;
  }
}
