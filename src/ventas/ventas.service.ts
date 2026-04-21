import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { NotificationService } from "../notifications/notification.service";

@Injectable()
export class VentasService {
  private notifier: NotificationService;

  constructor(private prisma: PrismaService) {
    this.notifier = new NotificationService(prisma);
  }

  async createVenta(data: any) {
    // 1) Crear cabecera
    let venta;

    try {
      venta = await this.prisma.venta.create({
        data: {
          clienteId: data.clienteId,
          metodoPago: data.metodoPago,
          ubicacion: data.ubicacion || null,
          observaciones: data.observaciones || null,
          total: 0,
          bodegaId: data.bodegaId || null,
          vendedor: data.vendedor || null,
        },
      });
    } catch (error) {
      console.error("Error al crear venta:", error);
      throw new Error(
        `No se pudo crear la venta. Verifique clienteId=${data.clienteId} o el método de pago.`,
      );
    }

    // 2) Crear detalle
    let subtotalTotal = 0;

    for (const item of data.detalle) {
      const precioUnit = item.precio;
      const bordado = item.bordado ?? 0;
      const descuento = item.descuento ?? 0;

      const precioConDescuento = precioUnit * (1 - (descuento || 0) / 100);
      const subtotal = item.cantidad * (precioConDescuento + bordado);
      subtotalTotal += subtotal;

      await this.prisma.detalleVenta.create({
        data: {
          ventaId: venta.id,
          productoId: item.productoId,
          cantidad: item.cantidad,
          precioUnit,
          bordado,
          descuento,
          descripcion: item.descripcion || "",
          subtotal,
        },
      });

      // 3) Descontar inventario
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
              decrement: item.cantidad,
            },
          },
        });
      } catch {
        await this.prisma.inventario.create({
          data: {
            bodegaId: data.bodegaId,
            productoId: item.productoId,
            stock: -item.cantidad,
          },
        });
      }

      // 3b) Notificación de stock bajo
      const invUpdated = await this.prisma.inventario.findUnique({
        where: { bodegaId_productoId: { bodegaId: data.bodegaId, productoId: item.productoId } },
      });
      const threshold = Number(process.env.STOCK_ALERT_THRESHOLD || 5);
      if (invUpdated && invUpdated.stock < threshold) {
        await this.notifier.notifyLowStock([{ bodegaId: data.bodegaId, productoId: item.productoId }]);
      }
    }

    // 4) Calcular recargo (solo si es tarjeta)
    let recargo = 0;
    let total = subtotalTotal;

    if (data.metodoPago === "tarjeta") {
      const porcentaje = Number(data.porcentajeRecargo) || 0;
      recargo = subtotalTotal * (porcentaje / 100);
      total += recargo;
    }

    // 5) Registrar pago
    await this.prisma.pagoVenta.create({
      data: {
        ventaId: venta.id,
        metodo: data.metodoPago,
        monto: total,
      },
    });

    // 6) Actualizar cabecera
    const ventaActualizada = await this.prisma.venta.update({
      where: { id: venta.id },
      data: {
        total,
        recargo,
      },
      include: {
        detalle: true,
        pagos: true,
        cliente: true,
        bodega: true,
      },
    });

    // 7) Notificación de venta alta
    await this.notifier.notifyHighSale(total, `V-${venta.id}`);

    return ventaActualizada;
  }

  findAll() {
    return this.prisma.venta.findMany({
      include: {
        detalle: true,
        pagos: true,
        cliente: true,
        bodega: true,
      },
    });
  }
}
