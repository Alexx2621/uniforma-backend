import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { assertBodegaAccess, getAllowedBodegaIds } from '../bodegas/bodega-access';
import { CorrelativosService } from '../correlativos/correlativos.service';

@Injectable()
export class IngresosService {
  constructor(
    private prisma: PrismaService,
    private correlativos: CorrelativosService,
  ) {}

  async crearIngreso(data: any, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    await assertBodegaAccess(this.prisma, user, Number(data.bodegaId), 'ajustes');
    const folioResp = user?.id
      ? await this.correlativos.generarUsuarioOperacionCorrelativo(Number(user.id), 'ingresoInventario')
      : null;
    // 1) Crear cabecera
    const ingreso = await this.prisma.ingresoInventario.create({
      data: {
        folio: folioResp?.correlativo || null,
        bodegaId: data.bodegaId,
        observaciones: data.observaciones || null,
        responsable: data.responsable || null,
      },
    });

    // 2) Registrar detalle + actualizar stock
    for (const item of data.detalle) {
      const producto = await this.prisma.producto.findUnique({
        where: { id: item.productoId },
        select: { stockMax: true },
      });

      const inventario = await this.prisma.inventario.findUnique({
        where: {
          bodegaId_productoId: {
            bodegaId: data.bodegaId,
            productoId: item.productoId,
          },
        },
      });

      const stockActual = inventario?.stock ?? 0;
      const stockMax = producto?.stockMax ?? 0;
      if (stockMax > 0 && stockActual + item.cantidad > stockMax) {
        const disponible = stockMax - stockActual;
        throw new BadRequestException(
          `No se puede ingresar mas de ${disponible < 0 ? 0 : disponible} unidades del producto ${item.productoId} en esta bodega (stock max ${stockMax})`,
        );
      }

      await this.prisma.detalleIngreso.create({
        data: {
          ingresoId: ingreso.id,
          productoId: item.productoId,
          cantidad: item.cantidad,
        },
      });

      // 3) Actualizar inventario
      try {
        await this.prisma.inventario.update({
          where: {
            bodegaId_productoId: {
              bodegaId: data.bodegaId,
              productoId: item.productoId,
            },
          },
          data: {
            stock: {
              increment: item.cantidad,
            },
          },
        });
      } catch {
        await this.prisma.inventario.create({
          data: {
            bodegaId: data.bodegaId,
            productoId: item.productoId,
            stock: item.cantidad,
          },
        });
      }

      // 4) Registrar movimiento log
      await this.prisma.movInventario.create({
        data: {
          bodegaId: data.bodegaId,
          productoId: item.productoId,
          tipo: 'ingreso',
          cantidad: item.cantidad,
          referencia: ingreso.folio || `Ingreso #${ingreso.id}`,
        },
      });
    }

    // 5) Retornar ingreso con detalle
    return this.prisma.ingresoInventario.findUnique({
      where: { id: ingreso.id },
      include: {
        bodega: true,
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
      },
    });
  }

  async importar(data: any, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const bodegaId = Number(data.bodegaId || 0);
    const items = Array.isArray(data.items) ? data.items : [];
    if (!bodegaId) throw new BadRequestException('Selecciona una bodega');
    if (!items.length) throw new BadRequestException('No hay articulos para importar');

    const codigos = items.map((item: any) => `${item.codigo || ''}`.trim()).filter(Boolean);
    const productos = await this.prisma.producto.findMany({
      where: { codigo: { in: codigos } },
      select: { id: true, codigo: true },
    });
    const porCodigo = new Map(productos.map((producto) => [producto.codigo, producto.id]));
    const noEncontrados = codigos.filter((codigo: string) => !porCodigo.has(codigo));
    if (noEncontrados.length) {
      throw new BadRequestException(`No se encontraron estos codigos: ${noEncontrados.join(', ')}`);
    }

    const acumulado = new Map<number, number>();
    for (const item of items) {
      const codigo = `${item.codigo || ''}`.trim();
      const productoId = porCodigo.get(codigo);
      const cantidad = Number(item.cantidad || 0);
      if (!productoId || cantidad <= 0) continue;
      acumulado.set(productoId, (acumulado.get(productoId) || 0) + cantidad);
    }
    if (!acumulado.size) throw new BadRequestException('Las cantidades importadas deben ser mayores a 0');

    return this.crearIngreso(
      {
        bodegaId,
        responsable: data.responsable,
        observaciones: data.observaciones || 'Importacion masiva de inventario',
        detalle: Array.from(acumulado.entries()).map(([productoId, cantidad]) => ({ productoId, cantidad })),
      },
      user,
    );
  }

  async findAll(query: any = {}, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
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
    const allowedIds = await getAllowedBodegaIds(this.prisma, user, 'ajustes');
    if (bodegaId > 0) {
      await assertBodegaAccess(this.prisma, user, bodegaId, 'ajustes');
      where.bodegaId = bodegaId;
    } else if (allowedIds !== null) {
      where.bodegaId = { in: allowedIds.length ? allowedIds : [-1] };
    }

    const responsable = `${query.responsable || ''}`.trim();
    if (responsable) {
      where.responsable = { contains: responsable };
    }

    return this.prisma.ingresoInventario.findMany({
      where,
      include: {
        bodega: true,
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
      },
      orderBy: { fecha: 'desc' },
    });
  }
}
