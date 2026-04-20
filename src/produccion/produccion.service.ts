import { Injectable } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaService } from "../prisma.service";
import { AlertasService } from "../alertas/alertas.service";

@Injectable()
export class ProduccionService {
  constructor(
    private prisma: PrismaService,
    private alertasService: AlertasService,
  ) {}

  private readonly systemConfigPath = join(process.cwd(), "storage", "system-config.json");

  private async getSystemConfig() {
    try {
      const raw = await readFile(this.systemConfigPath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        productionInternalMode: Boolean(parsed?.productionInternalMode),
        pedidoAlertRoleIds: this.normalizeRoleIds(parsed?.pedidoAlertRoleIds),
      };
    } catch {
      return {
        productionInternalMode: false,
        pedidoAlertRoleIds: [] as number[],
      };
    }
  }

  private normalizeRoleIds(raw: unknown): number[] {
    if (!Array.isArray(raw)) return [];
    return Array.from(
      new Set(raw.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)),
    );
  }

  private async crearAlertasNuevoPedido(pedido: any, data: any, pedidoAlertRoleIds: number[]) {
    const roleIds = this.normalizeRoleIds(pedidoAlertRoleIds);
    if (!roleIds.length) return;

    const bodega = pedido?.bodega?.nombre || "Sin bodega";
    const cliente = pedido?.cliente?.nombre || "Interno";
    const creador = `${data?.solicitadoPor || "Usuario"}`.trim();

    await this.alertasService.crearAlertasPorRoles({
      roleIds,
      tipo: "pedido_produccion_nuevo",
      titulo: "Nuevo pedido de produccion",
      mensaje: `Se genero el pedido P-${pedido.id} por ${creador}. Cliente: ${cliente}. Bodega: ${bodega}.`,
      payload: {
        pedidoId: pedido.id,
        estado: pedido.estado,
        bodegaId: pedido.bodegaId,
      },
    });
  }

  async crearPedido(data: any) {
    const systemConfig = await this.getSystemConfig();
    const productionInternalMode = systemConfig.productionInternalMode;
    const pedidoAlertRoleIds = this.normalizeRoleIds((systemConfig as any).pedidoAlertRoleIds);

    const pedido = await this.prisma.$transaction(async (tx) => {
      const detalles = data.detalle || [];
      const subtotal = detalles.reduce((sum, item) => {
        const precio = Number(item.precioUnit) || 0;
        const desc = Number(item.descuento) || 0;
        const cantidad = Number(item.cantidad) || 0;
        const precioDesc = precio * (1 - desc / 100);
        return sum + cantidad * precioDesc;
      }, 0);
      const porcRecargo =
        !productionInternalMode && data.metodoPago === "tarjeta" ? Number(data.porcentajeRecargo || 0) : 0;
      const recargo = subtotal * (porcRecargo / 100);
      const totalEstimado = subtotal + recargo;
      const anticipo = productionInternalMode ? 0 : Number(data.anticipo) || 0;

      if (!productionInternalMode && anticipo <= 0) {
        throw new Error("Debes registrar un anticipo mayor a 0");
      }
      if (!productionInternalMode && anticipo > totalEstimado) {
        throw new Error(
          `El anticipo (Q ${Number(anticipo || 0).toFixed(2)}) no puede superar el total (Q ${totalEstimado.toFixed(2)}).`
        );
      }

      const pedido = await tx.pedidoProduccion.create({
        data: {
          solicitadoPor: data.solicitadoPor || null,
          observaciones: data.observaciones || null,
          clienteId: productionInternalMode ? null : data.clienteId || null,
          bodegaId: data.bodegaId || null,
          totalEstimado,
          anticipo,
          saldoPendiente: productionInternalMode ? 0 : totalEstimado - anticipo,
          recargo: productionInternalMode ? 0 : recargo,
          porcentajeRecargo: productionInternalMode ? 0 : porcRecargo,
          metodoPago: productionInternalMode ? "interno" : data.metodoPago || "efectivo",
        },
      });

      for (const item of detalles) {
        await tx.detallePedidoProduccion.create({
          data: {
            pedidoId: pedido.id,
            productoId: item.productoId,
            cantidad: item.cantidad,
            precioUnit: item.precioUnit || 0,
            descuento: item.descuento || 0,
            descripcion: item.descripcion || "",
          },
        });
      }

      if (!productionInternalMode && anticipo > 0) {
        await tx.pagoPedido.create({
          data: {
            pedidoId: pedido.id,
            monto: anticipo,
            metodo: data.metodoPago || "efectivo",
            tipo: "anticipo",
            recargo: porcRecargo > 0 ? anticipo * (porcRecargo / 100) : 0,
            porcentajeRecargo: porcRecargo,
          },
        });
      }

      return tx.pedidoProduccion.findUnique({
        where: { id: pedido.id },
        include: {
          cliente: true,
          bodega: true,
        },
      });
    });

    if (pedido) {
      await this.crearAlertasNuevoPedido(pedido, data, pedidoAlertRoleIds);
    }

    return pedido;
  }

  async listarPedidos() {
    return this.prisma.pedidoProduccion.findMany({
      include: {
        detalle: { include: { producto: true } },
        avances: true,
        mermas: true,
        pagos: true,
        cliente: true,
        bodega: true,
      },
      orderBy: { id: "desc" },
    });
  }

  async detallePedido(id: number) {
    return this.prisma.pedidoProduccion.findUnique({
      where: { id },
      include: {
        detalle: { include: { producto: true } },
        avances: true,
        mermas: true,
        pagos: true,
        cliente: true,
        bodega: true,
      },
    });
  }

  async anularPedido(id: number) {
    const pedido = await this.prisma.pedidoProduccion.findUnique({
      where: { id },
    });

    if (!pedido) throw new Error(`Pedido ${id} no existe`);
    if (`${pedido.estado || ""}`.trim().toLowerCase() === "anulado") {
      return { mensaje: "Pedido ya anulado" };
    }
    if (["completado", "recibido"].includes(`${pedido.estado || ""}`.trim().toLowerCase())) {
      throw new Error("No se puede anular un pedido recibido");
    }

    await this.prisma.pedidoProduccion.update({
      where: { id },
      data: { estado: "anulado" },
    });

    return { mensaje: "Pedido anulado correctamente" };
  }

  async terminarPedido(id: number, data: any) {
    const systemConfig = await this.getSystemConfig();
    const productionInternalMode = systemConfig.productionInternalMode;

    return this.prisma.$transaction(async (tx) => {
      const pedido = await tx.pedidoProduccion.findUnique({
        where: { id },
        include: { detalle: true },
      });
      if (!pedido) throw new Error(`Pedido ${id} no existe`);

      const pagoFinal = productionInternalMode ? 0 : Number(data.pagoFinal) || 0;
      const porcRecargo =
        !productionInternalMode && data.metodoPagoFinal === "tarjeta"
          ? Number(data.porcentajeRecargo || 0)
          : 0;
      const recargoPago = pagoFinal * (porcRecargo / 100);
      const saldoActual = Number(pedido.saldoPendiente ?? 0);
      const saldoRestante = Math.max(0, saldoActual - (pagoFinal + recargoPago));
      if (!productionInternalMode && saldoRestante > 0) {
        throw new Error(`Saldo pendiente Q ${saldoRestante.toFixed(2)}. Liquida antes de finalizar.`);
      }

      await tx.pedidoProduccion.update({
        where: { id },
        data: {
          estado: "recibido",
          observaciones: data.observaciones || null,
          saldoPendiente: 0,
        },
      });

      /*
       * Movimiento a inventario deshabilitado temporalmente.
       * En el futuro, al reactivar esta seccion, el boton "Terminar pedido"
       * volvera a ingresar las cantidades producidas a la bodega seleccionada,
       * registrar los movimientos de inventario, descontar consumos de insumos
       * y aplicar la merma automatica de produccion.
       *
      for (const item of pedido.detalle) {
        await tx.inventario.upsert({
          where: { bodegaId_productoId: { bodegaId, productoId: item.productoId } },
          update: { stock: { increment: item.cantidad } },
          create: { bodegaId, productoId: item.productoId, stock: item.cantidad },
        });
        await tx.movInventario.create({
          data: {
            bodegaId,
            productoId: item.productoId,
            tipo: "ENTRADA PRODUCCION",
            cantidad: item.cantidad,
            referencia: `PEDIDO ${pedido.id}`,
          },
        });
      }

      for (const item of pedido.detalle) {
        const consumos = await tx.consumoInsumo.findMany({ where: { productoId: item.productoId } });
        for (const consumo of consumos) {
          const cantidadTotal = consumo.cantidadPorUnidad * item.cantidad;
          await tx.insumo.update({
            where: { id: consumo.insumoId },
            data: { stock: { decrement: cantidadTotal } },
          });
          await tx.movInventario.create({
            data: {
              bodegaId,
              productoId: item.productoId,
              tipo: "CONSUMO INSUMO",
              cantidad: cantidadTotal,
              referencia: `PEDIDO ${pedido.id}`,
            },
          });
        }
      }

      for (const item of pedido.detalle) {
        const producto = await tx.producto.findUnique({ where: { id: item.productoId } });
        const porcentaje = producto?.mermaPorcentaje ?? 0;
        if (porcentaje > 0) {
          const cantidadMerma = item.cantidad * (porcentaje / 100);
          await tx.mermaProduccion.create({
            data: {
              pedidoId: pedido.id,
              insumoId: null,
              cantidad: cantidadMerma,
              motivo: "Merma automatica por produccion",
            },
          });
          await tx.inventario.updateMany({
            where: { bodegaId, productoId: item.productoId },
            data: { stock: { decrement: cantidadMerma } },
          });
          await tx.movInventario.create({
            data: {
              bodegaId,
              productoId: item.productoId,
              tipo: "MERMA PRODUCCION",
              cantidad: cantidadMerma,
              referencia: `PEDIDO ${pedido.id}`,
            },
          });
        }
      }
      */

      if (!productionInternalMode && pagoFinal > 0) {
        await tx.pagoPedido.create({
          data: {
            pedidoId: pedido.id,
            monto: pagoFinal,
            metodo: data.metodoPagoFinal || "efectivo",
            tipo: "saldo",
            recargo: recargoPago,
            porcentajeRecargo: porcRecargo,
          },
        });
      }

      return { mensaje: "Pedido marcado como recibido" };
    });
  }

  async registrarPago(id: number, data: { monto: number; metodo: string; tipo?: string; porcentajeRecargo?: number }) {
    const systemConfig = await this.getSystemConfig();
    if (systemConfig.productionInternalMode) {
      throw new Error("Los pagos de pedidos estan deshabilitados en modo interno de produccion");
    }

    return this.prisma.$transaction(async (tx) => {
      const pedido = await tx.pedidoProduccion.findUnique({ where: { id } });
      if (!pedido) throw new Error(`Pedido ${id} no existe`);

      const monto = Number(data.monto) || 0;
      const porcRecargo = data.metodo === "tarjeta" ? Number(data.porcentajeRecargo || 0) : 0;
      const recargo = monto * (porcRecargo / 100);
      const aplicado = monto + recargo;
      const nuevoSaldo = Math.max(0, (pedido.saldoPendiente || 0) - aplicado);
      if (monto <= 0) throw new Error("Monto inválido");

      await tx.pagoPedido.create({
        data: {
          pedidoId: id,
          monto,
          metodo: data.metodo || "efectivo",
          tipo: data.tipo || "saldo",
          recargo,
          porcentajeRecargo: porcRecargo,
        },
      });

      await tx.pedidoProduccion.update({
        where: { id },
        data: {
          saldoPendiente: nuevoSaldo,
          estado: pedido.estado,
        },
      });

      return { saldoPendiente: nuevoSaldo };
    });
  }
}
