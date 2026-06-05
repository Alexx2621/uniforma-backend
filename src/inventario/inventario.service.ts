import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { assertBodegaAccess, buildBodegaWhere, getAllowedBodegaIds } from '../bodegas/bodega-access';

@Injectable()
export class InventarioService {
  constructor(private prisma: PrismaService) {}

  private productoInclude = {
    categoria: true,
    tela: true,
    color: true,
    talla: true,
  };

  private async buildInventarioWhere(user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    return buildBodegaWhere(this.prisma, user, 'stock');
  }

  private isAdmin(user?: { rol?: string | null }) {
    return `${user?.rol || ''}`.trim().toUpperCase() === 'ADMIN';
  }

  private hasPermission(user: { rol?: string | null; permisos?: string[] | null } | undefined, permission: string) {
    return this.isAdmin(user) || (Array.isArray(user?.permisos) && user.permisos.includes(permission));
  }

  private assertPermission(user: { rol?: string | null; permisos?: string[] | null } | undefined, permission: string, message = 'No tienes permisos para acceder') {
    if (!this.hasPermission(user, permission)) throw new ForbiddenException(message);
  }

  async obtenerStockActual(bodegaId: number, productoId: number, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    await assertBodegaAccess(this.prisma, user, bodegaId, 'stock');
    const inv = await this.prisma.inventario.findUnique({
      where: {
        bodegaId_productoId: {
          bodegaId,
          productoId,
        },
      },
    });
    return inv?.stock ?? 0;
  }

  async reporteInventario(user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const bodegaIds = await this.buildBodegaIdFilter(user, 'stock');
    const bodegaWhere = bodegaIds ? { id: { in: bodegaIds } } : { activa: true };

    const [inventarios, bodegas, productos] = await Promise.all([
      this.prisma.inventario.findMany({
        where: await this.buildInventarioWhere(user),
        include: {
          producto: { include: this.productoInclude },
          bodega: true,
        },
      }),
      this.prisma.bodega.findMany({
        where: bodegaWhere,
        orderBy: { nombre: 'asc' },
      }),
      this.prisma.producto.findMany({
        include: this.productoInclude,
        orderBy: { codigo: 'asc' },
      }),
    ]);

    const rowsByKey = new Map<string, any>();
    const toReporteRow = (producto: any, bodega: any, stock: number) => {
      const faltan = Number(producto.stockMax || 0) - Number(stock || 0);
      return {
        productoId: producto.id,
        bodegaId: bodega.id,
        codigo: producto.codigo,
        producto: producto.nombre,
        tipo: producto.tipo || 'N/D',
        genero: producto.genero || 'N/D',
        talla: producto.talla?.nombre || null,
        color: producto.color?.nombre || null,
        tela: producto.tela?.nombre || null,
        bodega: bodega.nombre,
        stock,
        stockMax: producto.stockMax,
        faltan: faltan > 0 ? faltan : 0,
      };
    };

    inventarios.forEach((item) => {
      rowsByKey.set(`${item.bodegaId}-${item.productoId}`, toReporteRow(item.producto, item.bodega, item.stock));
    });

    bodegas.forEach((bodega) => {
      productos.forEach((producto) => {
        const key = `${bodega.id}-${producto.id}`;
        if (!rowsByKey.has(key)) {
          rowsByKey.set(key, toReporteRow(producto, bodega, 0));
        }
      });
    });

    return Array.from(rowsByKey.values()).sort((a, b) => {
      const byBodega = `${a.bodega}`.localeCompare(`${b.bodega}`);
      if (byBodega) return byBodega;
      return `${a.codigo}`.localeCompare(`${b.codigo}`);
    });
  }

  async resumenPorProducto(user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const inventarios = await this.prisma.inventario.findMany({
      where: await this.buildInventarioWhere(user),
      include: {
        producto: { include: this.productoInclude },
        bodega: true,
      },
    });

    const pivot = new Map<number, any>();
    inventarios.forEach((item) => {
      if (!pivot.has(item.productoId)) {
        pivot.set(item.productoId, {
          id: item.productoId,
          codigo: item.producto.codigo,
          producto: item.producto.nombre,
          tipo: item.producto.tipo || 'N/D',
          genero: item.producto.genero || 'N/D',
          talla: item.producto.talla?.nombre || null,
          color: item.producto.color?.nombre || null,
          tela: item.producto.tela?.nombre || null,
          stockMax: item.producto.stockMax,
          total: 0,
          stocks: {},
        });
      }
      const row = pivot.get(item.productoId);
      row.stocks[item.bodegaId] = item.stock;
      row.total += item.stock;
    });

    return Array.from(pivot.values());
  }

  async kardex(query: any = {}, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    this.assertPermission(user, 'inventario.kardex.view', 'No tienes permisos para ver Kardex');
    const productoId = Number(query.productoId || 0);
    const bodegaId = Number(query.bodegaId || 0);
    if (bodegaId > 0) await assertBodegaAccess(this.prisma, user, bodegaId, 'stock');

    const bodegaWhere = bodegaId > 0 ? { bodegaId } : await this.buildInventarioWhere(user);
    const where: any = { ...bodegaWhere };
    if (productoId > 0) where.productoId = productoId;
    if (query.tipo) where.tipo = `${query.tipo}`.trim();
    const referencia = `${query.referencia || ''}`.trim();
    if (referencia) where.referencia = { contains: referencia };
    const desde = query.desde ? new Date(`${query.desde}T00:00:00`) : null;
    const hasta = query.hasta ? new Date(`${query.hasta}T23:59:59.999`) : null;
    if (desde || hasta) {
      where.fecha = {
        ...(desde ? { gte: desde } : {}),
        ...(hasta ? { lte: hasta } : {}),
      };
    }

    return this.prisma.movInventario.findMany({
      where,
      include: {
        bodega: true,
        producto: { include: this.productoInclude },
      },
      orderBy: { fecha: 'desc' },
      take: Math.min(Math.max(Number(query.limit || 500), 1), 2000),
    });
  }

  async alertasBodega(query: any = {}, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    if (!this.hasPermission(user, 'inventario.minimos.view') && !this.hasPermission(user, 'inventario.minimos.manage')) {
      throw new ForbiddenException('No tienes permisos para ver alertas de minimos');
    }
    const bodegaId = Number(query.bodegaId || 0);
    const whereMinimos: any = {};
    if (bodegaId > 0) {
      await assertBodegaAccess(this.prisma, user, bodegaId, 'stock');
      whereMinimos.bodegaId = bodegaId;
    } else {
      const allowed = await this.buildInventarioWhere(user);
      if ((allowed as any).bodegaId) whereMinimos.bodegaId = (allowed as any).bodegaId;
    }

    const minimos = await this.prisma.stockMinimoBodegaProducto.findMany({
      where: whereMinimos,
      include: {
        bodega: true,
        producto: { include: this.productoInclude },
      },
    });

    const rows: any[] = [];
    for (const minimo of minimos) {
      const inv = await this.prisma.inventario.findUnique({
        where: { bodegaId_productoId: { bodegaId: minimo.bodegaId, productoId: minimo.productoId } },
      });
      const stock = Number(inv?.stock || 0);
      if (stock <= minimo.minimo) {
        rows.push({
          id: minimo.id,
          bodegaId: minimo.bodegaId,
          productoId: minimo.productoId,
          bodega: minimo.bodega,
          producto: minimo.producto,
          minimo: minimo.minimo,
          stock,
          faltan: Math.max(minimo.minimo - stock, 0),
        });
      }
    }
    return rows;
  }

  async guardarMinimo(data: any, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    this.assertPermission(user, 'inventario.minimos.manage', 'No tienes permisos para gestionar minimos');
    const bodegaId = Number(data.bodegaId || 0);
    const productoId = Number(data.productoId || 0);
    const minimo = Math.max(0, Number(data.minimo || 0));
    if (!bodegaId || !productoId) throw new BadRequestException('Selecciona bodega y producto');
    await assertBodegaAccess(this.prisma, user, bodegaId, 'ajustes');

    return this.prisma.stockMinimoBodegaProducto.upsert({
      where: { bodegaId_productoId: { bodegaId, productoId } },
      update: { minimo },
      create: { bodegaId, productoId, minimo },
      include: {
        bodega: true,
        producto: { include: this.productoInclude },
      },
    });
  }

  async crearConteo(data: any, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const bodegaId = Number(data.bodegaId || 0);
    const detalle = Array.isArray(data.detalle) ? data.detalle : [];
    if (!bodegaId) throw new BadRequestException('Selecciona una bodega');
    if (!detalle.length) throw new BadRequestException('Agrega al menos un producto al conteo');
    await assertBodegaAccess(this.prisma, user, bodegaId, 'ajustes');

    const conteo = await this.prisma.conteoInventario.create({
      data: {
        folio: `CT-${Date.now()}`,
        bodegaId,
        responsable: data.responsable || null,
        observaciones: data.observaciones || null,
      },
    });

    for (const item of detalle) {
      const productoId = Number(item.productoId || 0);
      const stockFisico = Math.max(0, Number(item.stockFisico ?? item.cantidad ?? 0));
      if (!productoId) throw new BadRequestException('El conteo contiene un producto invalido');

      const inv = await this.prisma.inventario.findUnique({
        where: { bodegaId_productoId: { bodegaId, productoId } },
      });
      const stockSistema = Number(inv?.stock || 0);
      const diferencia = stockFisico - stockSistema;

      await this.prisma.detalleConteoInventario.create({
        data: {
          conteoId: conteo.id,
          productoId,
          stockSistema,
          stockFisico,
          diferencia,
        },
      });

      await this.prisma.inventario.upsert({
        where: { bodegaId_productoId: { bodegaId, productoId } },
        update: { stock: stockFisico },
        create: { bodegaId, productoId, stock: stockFisico },
      });

      if (diferencia !== 0) {
        await this.prisma.movInventario.create({
          data: {
            bodegaId,
            productoId,
            tipo: 'conteo_ajuste',
            cantidad: diferencia,
            referencia: conteo.folio || `Conteo #${conteo.id}`,
          },
        });
      }
    }

    return this.prisma.conteoInventario.findUnique({
      where: { id: conteo.id },
      include: {
        bodega: true,
        detalle: { include: { producto: { include: this.productoInclude } } },
      },
    });
  }

  async listarConteos(query: any = {}, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const where: any = {};
    const desde = query.desde ? new Date(`${query.desde}T00:00:00`) : null;
    const hasta = query.hasta ? new Date(`${query.hasta}T23:59:59.999`) : null;
    if (desde || hasta) {
      where.fecha = {
        ...(desde ? { gte: desde } : {}),
        ...(hasta ? { lte: hasta } : {}),
      };
    }
    const bodegaId = Number(query.bodegaId || 0);
    if (bodegaId > 0) {
      await assertBodegaAccess(this.prisma, user, bodegaId, 'ajustes');
      where.bodegaId = bodegaId;
    } else {
      const allowed = await buildBodegaWhere(this.prisma, user, 'ajustes');
      if ((allowed as any).bodegaId) where.bodegaId = (allowed as any).bodegaId;
    }
    return this.prisma.conteoInventario.findMany({
      where,
      include: {
        bodega: true,
        detalle: { include: { producto: { include: this.productoInclude } } },
      },
      orderBy: { fecha: 'desc' },
    });
  }

  private async buildBodegaIdFilter(user: { id?: number; rol?: string | null; permisos?: string[] | null } | undefined, operacion: 'stock' | 'ajustes' | 'traslados' = 'stock') {
    const allowed = await getAllowedBodegaIds(this.prisma, user, operacion);
    return allowed === null ? null : allowed.length ? allowed : [-1];
  }

  private getTodayRange() {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  async panelOperativo(user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const stockBodegas = await this.buildBodegaIdFilter(user, 'stock');
    const ajustesBodegas = await this.buildBodegaIdFilter(user, 'ajustes');
    const trasladosBodegas = await this.buildBodegaIdFilter(user, 'traslados');
    const { start, end } = this.getTodayRange();

    const solicitudWhere: any = {
      estado: { notIn: ['RECIBIDO', 'CANCELADO'] },
    };
    if (trasladosBodegas) {
      solicitudWhere.OR = [
        { desdeBodegaId: { in: trasladosBodegas } },
        { haciaBodegaId: { in: trasladosBodegas } },
      ];
    }

    const trasladoWhere: any = {
      estado: { in: ['PENDIENTE', 'PREPARADO', 'EN_TRANSITO'] },
    };
    if (trasladosBodegas) {
      trasladoWhere.OR = [
        { desdeBodegaId: { in: trasladosBodegas } },
        { haciaBodegaId: { in: trasladosBodegas } },
      ];
    }

    const ingresosWhere: any = {
      fecha: { gte: start, lte: end },
    };
    if (ajustesBodegas) ingresosWhere.bodegaId = { in: ajustesBodegas };

    const conteosWhere: any = {};
    if (ajustesBodegas) conteosWhere.bodegaId = { in: ajustesBodegas };

    const alertas = await this.alertasBodega({}, user);
    const [solicitudes, traslados, ingresosHoy, conteosRecientes, movimientosRecientes] = await Promise.all([
      this.prisma.solicitudTraslado.findMany({
        where: solicitudWhere,
        include: {
          venta: true,
          desdeBodega: true,
          haciaBodega: true,
          detalle: { include: { producto: { include: this.productoInclude } } },
        },
        orderBy: { fecha: 'desc' },
        take: 20,
      }),
      this.prisma.traslado.findMany({
        where: trasladoWhere,
        include: {
          desdeBodega: true,
          haciaBodega: true,
          detalle: { include: { producto: { include: this.productoInclude } } },
        },
        orderBy: { fecha: 'desc' },
        take: 20,
      }),
      this.prisma.ingresoInventario.findMany({
        where: ingresosWhere,
        include: {
          bodega: true,
          detalle: { include: { producto: { include: this.productoInclude } } },
        },
        orderBy: { fecha: 'desc' },
        take: 10,
      }),
      this.prisma.conteoInventario.findMany({
        where: conteosWhere,
        include: {
          bodega: true,
          detalle: { include: { producto: { include: this.productoInclude } } },
        },
        orderBy: { fecha: 'desc' },
        take: 10,
      }),
      this.prisma.movInventario.findMany({
        where: stockBodegas ? { bodegaId: { in: stockBodegas } } : {},
        include: {
          bodega: true,
          producto: { include: this.productoInclude },
        },
        orderBy: { fecha: 'desc' },
        take: 12,
      }),
    ]);

    const diferenciaConteos = conteosRecientes.reduce(
      (sum, conteo) => sum + (conteo.detalle || []).reduce((acc, item) => acc + Math.abs(Number(item.diferencia || 0)), 0),
      0,
    );

    return {
      generadoEn: new Date(),
      resumen: {
        solicitudesPendientes: solicitudes.length,
        trasladosEnProceso: traslados.length,
        productosBajoMinimo: alertas.length,
        ingresosHoy: ingresosHoy.length,
        conteosRecientes: conteosRecientes.length,
        diferenciaConteos,
      },
      solicitudes,
      traslados,
      alertas: alertas.slice(0, 20),
      ingresosHoy,
      conteosRecientes,
      movimientosRecientes,
    };
  }
}
