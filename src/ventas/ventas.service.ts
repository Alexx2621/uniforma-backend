import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { NotificationService } from "../notifications/notification.service";

@Injectable()
export class VentasService {
  private notifier: NotificationService;

  constructor(private prisma: PrismaService) {
    this.notifier = new NotificationService(prisma);
  }

  private normalizarMetodoPago(value?: string | null) {
    return `${value || "efectivo"}`.trim().toLowerCase();
  }

  private metodoUsaRecargo(value?: string | null) {
    const metodo = this.normalizarMetodoPago(value);
    return metodo === "tarjeta" || metodo === "visalink";
  }

  private metodoRequiereReferencia(value?: string | null) {
    const metodo = this.normalizarMetodoPago(value);
    return metodo !== "efectivo";
  }

  private async ensureClienteCfId() {
    const existenteCf = await this.prisma.cliente.findFirst({
      where: { nombre: "CF" },
    });

    if (existenteCf) return existenteCf.id;

    const consumidorFinal = await this.prisma.cliente.findFirst({
      where: { nombre: "Consumidor final" },
    });

    if (consumidorFinal) {
      const actualizado = await this.prisma.cliente.update({
        where: { id: consumidorFinal.id },
        data: {
          nombre: "CF",
          tipoCliente: consumidorFinal.tipoCliente || "CONSUMIDOR FINAL",
        },
      });
      return actualizado.id;
    }

    const creado = await this.prisma.cliente.create({
      data: {
        nombre: "CF",
        tipoCliente: "CONSUMIDOR FINAL",
      },
    });

    return creado.id;
  }

  async createVenta(data: any) {
    const metodoPago = this.normalizarMetodoPago(data?.metodoPago);
    const referencia = `${data?.referenciaPago || data?.referencia || ""}`.trim();
    const clienteNombre = `${data?.clienteNombre || ""}`.trim();
    const clienteTelefono = `${data?.clienteTelefono || ""}`.trim();
    const esConsumidorFinal = !clienteTelefono && (!clienteNombre || clienteNombre.toUpperCase() === "CF");
    const clienteIdRecibido = Number(data?.clienteId);
    const clienteId =
      Number.isInteger(clienteIdRecibido) && clienteIdRecibido > 0
        ? clienteIdRecibido
        : esConsumidorFinal
          ? await this.ensureClienteCfId()
          : null;

    if (this.metodoRequiereReferencia(metodoPago) && !referencia) {
      throw new Error("La referencia del pago es obligatoria para este metodo");
    }

    // 1) Crear cabecera
    let venta;

    try {
      venta = await this.prisma.venta.create({
        data: {
          clienteId,
          clienteNombre: clienteNombre || "CF",
          clienteTelefono: clienteTelefono || null,
          metodoPago,
          ubicacion: data.ubicacion || null,
          observaciones: null,
          total: 0,
          bodegaId: data.bodegaId || null,
          vendedor: data.vendedor || null,
        },
      });
    } catch (error) {
      console.error("Error al crear venta:", error);
      throw new Error(
        `No se pudo crear la venta. Verifique clienteId=${clienteId} o el metodo de pago.`,
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

    // 4) Calcular recargo (tarjeta y visalink)
    let recargo = 0;
    let total = subtotalTotal;

    if (this.metodoUsaRecargo(metodoPago)) {
      const porcentaje = Number(data.porcentajeRecargo) || 0;
      recargo = subtotalTotal * (porcentaje / 100);
      total += recargo;
    }

    // 5) Registrar pago
    await this.prisma.pagoVenta.create({
      data: {
        ventaId: venta.id,
        metodo: metodoPago,
        monto: total,
        referencia: this.metodoRequiereReferencia(metodoPago) ? referencia : null,
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
