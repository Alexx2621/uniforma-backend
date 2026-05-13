import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { CorrelativosService } from "../correlativos/correlativos.service";

@Injectable()
export class VentasService {
  private notifier: NotificationService;

  constructor(
    private prisma: PrismaService,
    private correlativos: CorrelativosService,
  ) {
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

  private async usaInventarioEnVentas() {
    const config = await this.prisma.notificacionConfig.findUnique({
      where: { id: 1 },
      select: { salesInventoryEnabled: true },
    });
    return config?.salesInventoryEnabled !== false;
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

  private async buscarUsuarioVendedor(vendedor?: string | null) {
    const value = `${vendedor || ""}`.trim();
    if (!value) return null;

    return this.prisma.usuario.findFirst({
      where: {
        OR: [
          { usuario: value },
          { nombre: value },
        ],
      },
      select: { id: true },
    });
  }

  private async completarFoliosPendientes() {
    const pendientes = await this.prisma.$queryRaw<Array<{ id: number; vendedor: string | null }>>`
      SELECT id, vendedor FROM Venta WHERE folio IS NULL ORDER BY id ASC
    `;

    for (const venta of pendientes) {
      const usuario = await this.buscarUsuarioVendedor(venta.vendedor);
      if (!usuario?.id) continue;

      const folioResp = await this.correlativos.generarUsuarioOperacionCorrelativo(usuario.id, "venta");
      await this.prisma.$executeRaw`UPDATE Venta SET folio = ${folioResp.correlativo} WHERE id = ${venta.id} AND folio IS NULL`;
    }
  }

  private async assertClienteCartera(clienteId?: number | null, user?: { id?: number; rol?: string | null }) {
    if (!clienteId) return;
    if (`${user?.rol || ""}`.toUpperCase() === "ADMIN") return;
    const cliente = await this.prisma.cliente.findUnique({
      where: { id: Number(clienteId) },
      select: { usuarioId: true },
    });
    if (!cliente || Number(cliente.usuarioId || 0) !== Number(user?.id || 0)) {
      throw new Error("El cliente seleccionado no pertenece a tu cartera");
    }
  }

  async createVenta(data: any, usuarioId?: number | null, user?: { id?: number; rol?: string | null }) {
    const metodoPago = this.normalizarMetodoPago(data?.metodoPago);
    const referencia = `${data?.referenciaPago || data?.referencia || ""}`.trim();
    const banco = `${data?.bancoPago || data?.banco || ""}`.trim();
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
    await this.assertClienteCartera(esConsumidorFinal ? null : clienteId, user);

    if (this.metodoRequiereReferencia(metodoPago) && !referencia) {
      throw new Error("La referencia del pago es obligatoria para este metodo");
    }
    if (metodoPago === "deposito_bancario" && !banco) {
      throw new Error("El banco es obligatorio para deposito bancario");
    }
    const descontarInventario = await this.usaInventarioEnVentas();
    const folioResp = usuarioId
      ? await this.correlativos.generarUsuarioOperacionCorrelativo(Number(usuarioId), "venta")
      : null;
    const folio = folioResp?.correlativo || null;

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
          envio: Math.max(0, Number(data.envio || 0)),
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

    if (folio) {
      await this.prisma.$executeRaw`UPDATE Venta SET folio = ${folio} WHERE id = ${venta.id}`;
    }

    // 2) Crear detalle
    let subtotalTotal = 0;

    for (const item of data.detalle) {
      const precioUnit = item.precio;
      const bordado = item.bordado ?? 0;
      const descuento = item.descuento ?? 0;
      const estiloEspecial = Boolean(item.estiloEspecial);
      const estiloEspecialMonto = estiloEspecial ? Number(item.estiloEspecialMonto ?? 0) : 0;

      const precioConDescuento = (precioUnit + estiloEspecialMonto) * (1 - (descuento || 0) / 100);
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
        } as any,
      });

      if (descontarInventario) {
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
    }

    // 4) Calcular recargo (tarjeta y visalink)
    let recargo = 0;
    const envio = Math.max(0, Number(data.envio || 0));
    let total = subtotalTotal + envio;

    if (this.metodoUsaRecargo(metodoPago)) {
      const porcentaje = Number(data.porcentajeRecargo) || 0;
      recargo = subtotalTotal * (porcentaje / 100);
      total += recargo;
    }

    // 5) Registrar pago
    const pago = await this.prisma.pagoVenta.create({
      data: {
        ventaId: venta.id,
        metodo: metodoPago,
        monto: total,
        referencia: this.metodoRequiereReferencia(metodoPago) ? referencia : null,
      },
    });
    if (metodoPago === "deposito_bancario" && banco) {
      await this.prisma.$executeRaw`UPDATE PagoVenta SET banco = ${banco} WHERE id = ${pago.id}`;
    }

    // 6) Actualizar cabecera
    const ventaActualizada = await this.prisma.venta.update({
      where: { id: venta.id },
      data: {
        total,
        recargo,
        envio,
      },
      include: {
        detalle: true,
        pagos: true,
        cliente: true,
        bodega: true,
      },
    });

    // 7) Notificación de venta alta
    await this.notifier.notifyHighSale(total, folio || `V-${venta.id}`);

    return { ...ventaActualizada, folio };
  }

  async findAll() {
    await this.completarFoliosPendientes();

    const ventas = await this.prisma.venta.findMany({
      include: {
        detalle: true,
        pagos: true,
        cliente: true,
        bodega: true,
      },
    });
    const folios = await this.prisma.$queryRaw<Array<{ id: number; folio: string | null }>>`SELECT id, folio FROM Venta`;
    const bancosPago = await this.prisma.$queryRaw<Array<{ id: number; banco: string | null }>>`SELECT id, banco FROM PagoVenta`;
    const folioMap = new Map(folios.map((row) => [Number(row.id), row.folio]));
    const bancoPagoMap = new Map(bancosPago.map((row) => [Number(row.id), row.banco]));
    return ventas.map((venta) => ({
      ...venta,
      folio: folioMap.get(Number(venta.id)) || null,
      pagos: Array.isArray(venta.pagos)
        ? venta.pagos.map((pago: any) => ({
            ...pago,
            banco: bancoPagoMap.get(Number(pago.id)) || null,
          }))
        : [],
    }));
  }
}
