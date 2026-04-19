import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class InventarioService {
  constructor(private prisma: PrismaService) {}

  async obtenerStockActual(bodegaId: number, productoId: number) {
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

  async reporteInventario() {
    const rows = await this.prisma.inventario.findMany({
      include: {
        producto: {
          include: {
            categoria: true,
            tela: true,
            color: true,
            talla: true,
          },
        },
        bodega: true,
      },
    });

    // Transformar resultado para frontend
    return rows.map((item) => {
      const faltan = item.producto.stockMax - item.stock;

      return {
        productoId: item.productoId,
        bodegaId: item.bodegaId,
        codigo: item.producto.codigo,
        producto: item.producto.nombre,
        tipo: item.producto.tipo || 'N/D',
        talla: item.producto.talla?.nombre || null,
        color: item.producto.color?.nombre || null,
        tela: item.producto.tela?.nombre || null,
        bodega: item.bodega.nombre,
        stock: item.stock,
        stockMax: item.producto.stockMax,
        faltan: faltan > 0 ? faltan : 0,
      };
    });
  }

  async resumenPorProducto() {
    const inventarios = await this.prisma.inventario.findMany({
      include: {
        producto: {
          include: {
            talla: true,
            color: true,
            tela: true,
          },
        },
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
}
