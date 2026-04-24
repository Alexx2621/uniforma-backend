import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class IngresosService {
  constructor(private prisma: PrismaService) {}

  async crearIngreso(data: any) {
    // 1) Crear cabecera
    const ingreso = await this.prisma.ingresoInventario.create({
      data: {
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
          referencia: `Ingreso #${ingreso.id}`,
        },
      });
    }

    // 5) Retornar ingreso con detalle
    return this.prisma.ingresoInventario.findUnique({
      where: { id: ingreso.id },
      include: {
        detalle: true,
      },
    });
  }

  findAll() {
    return this.prisma.ingresoInventario.findMany({
      include: {
        detalle: true,
      },
    });
  }
}
