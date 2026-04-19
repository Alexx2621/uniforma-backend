import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { NotificationService } from "../notifications/notification.service";

@Injectable()
export class TrasladosService {
  private notifier: NotificationService;

  constructor(private prisma: PrismaService) {
    this.notifier = new NotificationService(prisma);
  }

  async crearTraslado(data: any) {
    // 1) Crear cabecera
    const traslado = await this.prisma.traslado.create({
      data: {
        desdeBodegaId: data.desdeBodegaId,
        haciaBodegaId: data.haciaBodegaId,
        observaciones: data.observaciones || null,
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
            referencia: `Traslado #${traslado.id}`,
          },
          {
            bodegaId: data.haciaBodegaId,
            productoId: item.productoId,
            tipo: "traslado_entrada",
            cantidad: item.cantidad,
            referencia: `Traslado #${traslado.id}`,
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
        detalle: true,
        desdeBodega: true,
        haciaBodega: true,
      },
    });
  }

  findAll() {
    return this.prisma.traslado.findMany({
      include: {
        detalle: true,
        desdeBodega: true,
        haciaBodega: true,
      },
    });
  }
}
