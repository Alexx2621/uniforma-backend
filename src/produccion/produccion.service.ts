import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { AlertasService } from "../alertas/alertas.service";
import { ProduccionGateway } from "./produccion.gateway";

@Injectable()
export class ProduccionService {
  constructor(
    private prisma: PrismaService,
    private alertasService: AlertasService,
    private produccionGateway: ProduccionGateway,
  ) {}

  private async getSystemConfig() {
    const config = await this.prisma.notificacionConfig.findUnique({
      where: { id: 1 },
      select: {
        pedidoAlertRoleIds: true,
      },
    });

    return {
      pedidoAlertRoleIds: this.normalizeRoleIds(config?.pedidoAlertRoleIds),
    };
  }

  private normalizeRoleIds(raw: unknown): number[] {
    if (!Array.isArray(raw)) return [];
    return Array.from(
      new Set(raw.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)),
    );
  }

  private normalizarMetodoPago(value?: string | null) {
    return `${value || "efectivo"}`.trim().toLowerCase();
  }

  private metodoUsaRecargo(value?: string | null) {
    const metodo = this.normalizarMetodoPago(value);
    return metodo === "tarjeta" || metodo === "visalink";
  }

  private metodoRequiereReferencia(value?: string | null) {
    return this.normalizarMetodoPago(value) !== "efectivo";
  }

  private sanitizeCorrelativoCode(value?: string | null) {
    const normalized = `${value || ""}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    return normalized || "US";
  }

  private formatUsuarioOperacionCorrelativo(prefijo: string, codigoUsuario: string, numero: number) {
    return `${prefijo}-${codigoUsuario}-${`${numero}`.padStart(4, "0")}`;
  }

  private async generarCorrelativoUsuarioOperacion(
    tx: any,
    usuarioId: number | undefined,
    operacion: string,
    prefijo: string,
  ) {
    if (!usuarioId) {
      throw new Error("No se pudo identificar el usuario para generar el correlativo");
    }

    const usuario = await tx.usuario.findUnique({
      where: { id: Number(usuarioId) },
      select: { id: true, usuario: true, usuarioCorrelativo: true },
    });

    if (!usuario) {
      throw new Error("Usuario no encontrado para generar correlativo");
    }

    const codigoUsuario = this.sanitizeCorrelativoCode(usuario.usuarioCorrelativo || usuario.usuario);
    const existente = await tx.usuarioCorrelativoContador.findUnique({
      where: {
        usuarioId_operacion: {
          usuarioId: usuario.id,
          operacion,
        },
      },
    });

    if (!existente) {
      await tx.usuarioCorrelativoContador.create({
        data: {
          usuarioId: usuario.id,
          operacion,
          prefijo,
          codigoUsuario,
          siguienteNumero: 2,
        },
      });
      return this.formatUsuarioOperacionCorrelativo(prefijo, codigoUsuario, 1);
    }

    const numero = Number(existente.siguienteNumero || 1);
    await tx.usuarioCorrelativoContador.update({
      where: { id: existente.id },
      data: { siguienteNumero: numero + 1 },
    });

    return this.formatUsuarioOperacionCorrelativo(existente.prefijo, existente.codigoUsuario, numero);
  }

  private normalizeDetallePedido(detalle: any) {
    return {
      ...detalle,
      cantidad: Number(detalle?.cantidad || 0),
      precioUnit: Number(detalle?.precioUnit || 0),
      bordado: Number(detalle?.bordado ?? 0),
      estiloEspecial: Boolean(detalle?.estiloEspecial),
      estiloEspecialMonto: Number(detalle?.estiloEspecialMonto ?? 0),
      descuento: Number(detalle?.descuento ?? 0),
    };
  }

  private normalizePedidoResponse(pedido: any) {
    if (!pedido) return pedido;
    return {
      ...pedido,
      totalEstimado: Number(pedido?.totalEstimado || 0),
      anticipo: Number(pedido?.anticipo || 0),
      saldoPendiente: Number(pedido?.saldoPendiente || 0),
      recargo: Number(pedido?.recargo || 0),
      porcentajeRecargo: Number(pedido?.porcentajeRecargo || 0),
      detalle: Array.isArray(pedido?.detalle) ? pedido.detalle.map((item: any) => this.normalizeDetallePedido(item)) : [],
      pagos: Array.isArray(pedido?.pagos)
        ? pedido.pagos.map((pago: any) => ({
            ...pago,
            monto: Number(pago?.monto || 0),
            recargo: Number(pago?.recargo || 0),
            porcentajeRecargo: Number(pago?.porcentajeRecargo || 0),
          }))
        : [],
    };
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
      mensaje: `Se genero el pedido ${pedido?.folio || `P-${pedido.id}`} por ${creador}. Cliente: ${cliente}. Bodega: ${bodega}.`,
      payload: {
        pedidoId: pedido.id,
        estado: pedido.estado,
        bodegaId: pedido.bodegaId,
      },
    });
  }

  async crearPedido(data: any, usuarioId?: number) {
    const systemConfig = await this.getSystemConfig();
    const pedidoAlertRoleIds = this.normalizeRoleIds((systemConfig as any).pedidoAlertRoleIds);

    const pedido = await this.prisma.$transaction(async (tx) => {
      const detalles = data.detalle || [];
      const metodoPago = this.normalizarMetodoPago(data.metodoPago);
      const referencia = `${data?.referenciaPago || data?.referencia || ""}`.trim();
      const clienteNombre = `${data?.clienteNombre || ""}`.trim();
      const clienteTelefono = `${data?.clienteTelefono || ""}`.trim();
      const subtotal = detalles.reduce((sum, item) => {
        const precio = Number(item.precioUnit) || 0;
        const bordado = Number(item.bordado) || 0;
        const estiloEspecialMonto = item.estiloEspecial ? Number(item.estiloEspecialMonto) || 0 : 0;
        const desc = Number(item.descuento) || 0;
        const cantidad = Number(item.cantidad) || 0;
        const baseConEstilo = precio + estiloEspecialMonto;
        const precioConDescuento = baseConEstilo * (1 - desc / 100);
        return sum + cantidad * (precioConDescuento + bordado);
      }, 0);
      const porcRecargo = this.metodoUsaRecargo(metodoPago) ? Number(data.porcentajeRecargo || 0) : 0;
      const recargo = subtotal * (porcRecargo / 100);
      const totalEstimado = subtotal + recargo;
      const anticipo = Number(data.anticipo) || 0;

      if (anticipo <= 0) {
        throw new Error("Debes registrar un anticipo mayor a 0");
      }
      if (anticipo > totalEstimado) {
        throw new Error(
          `El anticipo (Q ${Number(anticipo || 0).toFixed(2)}) no puede superar el total (Q ${totalEstimado.toFixed(2)}).`
        );
      }
      if (this.metodoRequiereReferencia(metodoPago) && !referencia) {
        throw new Error("La referencia del pago es obligatoria para este metodo");
      }

      const folio = await this.generarCorrelativoUsuarioOperacion(tx, usuarioId, "pedido", "PE");
      const pedido = await tx.pedidoProduccion.create({
        data: {
          folio,
          solicitadoPor: data.solicitadoPor || null,
          observaciones: data.observaciones || null,
          clienteId: data.clienteId || null,
          clienteNombre: clienteNombre || "Mostrador",
          clienteTelefono: clienteTelefono || null,
          bodegaId: data.bodegaId || null,
          totalEstimado,
          anticipo,
          saldoPendiente: totalEstimado - anticipo,
          recargo,
          porcentajeRecargo: porcRecargo,
          metodoPago,
        },
      });

      for (const item of detalles) {
        await tx.detallePedidoProduccion.create({
          data: {
            pedidoId: pedido.id,
            productoId: item.productoId,
            cantidad: Number(item.cantidad) || 0,
            precioUnit: Number(item.precioUnit) || 0,
            bordado: Number(item.bordado) || 0,
            estiloEspecial: Boolean(item.estiloEspecial),
            estiloEspecialMonto: item.estiloEspecial ? Number(item.estiloEspecialMonto) || 0 : 0,
            descuento: Number(item.descuento) || 0,
            descripcion: item.descripcion || "",
          },
        });
      }

      if (anticipo > 0) {
        await tx.pagoPedido.create({
          data: {
            pedidoId: pedido.id,
            monto: anticipo,
            metodo: metodoPago,
            tipo: "anticipo",
            recargo: porcRecargo > 0 ? anticipo * (porcRecargo / 100) : 0,
            porcentajeRecargo: porcRecargo,
            referencia: this.metodoRequiereReferencia(metodoPago) ? referencia : null,
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
      this.produccionGateway.emitPedidosActualizados({
        action: 'created',
        pedidoId: pedido.id,
      });
    }

    return pedido;
  }

  async listarPedidos() {
    const pedidos = await this.prisma.pedidoProduccion.findMany({
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
    return pedidos.map((pedido) => this.normalizePedidoResponse(pedido));
  }

  async detallePedido(id: number) {
    const pedido = await this.prisma.pedidoProduccion.findUnique({
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
    return this.normalizePedidoResponse(pedido);
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

    this.produccionGateway.emitPedidosActualizados({
      action: 'cancelled',
      pedidoId: id,
    });

    return { mensaje: "Pedido anulado correctamente" };
  }

  async terminarPedido(id: number, data: any) {
    const result = await this.prisma.$transaction(async (tx) => {
      const pedido = await tx.pedidoProduccion.findUnique({
        where: { id },
        include: { detalle: true },
      });
      if (!pedido) throw new Error(`Pedido ${id} no existe`);

      const pagoFinal = Number(data.pagoFinal) || 0;
      const metodoPagoFinal = this.normalizarMetodoPago(data.metodoPagoFinal);
      const referenciaPagoFinal = `${data?.referenciaPagoFinal || data?.referenciaPago || data?.referencia || ""}`.trim();
      const porcRecargo =
        this.metodoUsaRecargo(metodoPagoFinal)
          ? Number(data.porcentajeRecargo || 0)
          : 0;
      const recargoPago = pagoFinal * (porcRecargo / 100);
      const saldoActual = Number(pedido.saldoPendiente ?? 0);
      const saldoRestante = Math.max(0, saldoActual - (pagoFinal + recargoPago));
      if (saldoRestante > 0) {
        throw new Error(`Saldo pendiente Q ${saldoRestante.toFixed(2)}. Liquida antes de finalizar.`);
      }
      if (pagoFinal > 0 && this.metodoRequiereReferencia(metodoPagoFinal) && !referenciaPagoFinal) {
        throw new Error("La referencia del pago es obligatoria para este metodo");
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

      if (pagoFinal > 0) {
        await tx.pagoPedido.create({
          data: {
            pedidoId: pedido.id,
            monto: pagoFinal,
            metodo: metodoPagoFinal,
            tipo: "saldo",
            recargo: recargoPago,
            porcentajeRecargo: porcRecargo,
            referencia: this.metodoRequiereReferencia(metodoPagoFinal) ? referenciaPagoFinal : null,
          },
        });
      }

      return { mensaje: "Pedido marcado como recibido" };
    });

    this.produccionGateway.emitPedidosActualizados({
      action: 'completed',
      pedidoId: id,
    });

    return result;
  }

  async registrarPago(
    id: number,
    data: { monto: number; metodo: string; tipo?: string; porcentajeRecargo?: number; referencia?: string; referenciaPago?: string },
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const pedido = await tx.pedidoProduccion.findUnique({ where: { id } });
      if (!pedido) throw new Error(`Pedido ${id} no existe`);

      const monto = Number(data.monto) || 0;
      const metodo = this.normalizarMetodoPago(data.metodo);
      const referencia = `${data.referenciaPago || data.referencia || ""}`.trim();
      const porcRecargo = this.metodoUsaRecargo(metodo) ? Number(data.porcentajeRecargo || 0) : 0;
      const recargo = monto * (porcRecargo / 100);
      const aplicado = monto + recargo;
      const saldoActual = Number(pedido.saldoPendiente || 0);
      if (aplicado > saldoActual) {
        throw new Error(`El pago mas recargo no puede superar el saldo pendiente Q ${saldoActual.toFixed(2)}`);
      }
      const nuevoSaldo = Math.max(0, saldoActual - aplicado);
      if (this.metodoRequiereReferencia(metodo) && !referencia) {
        throw new Error("La referencia del pago es obligatoria para este metodo");
      }
      if (monto <= 0) throw new Error("Monto inválido");

      await tx.pagoPedido.create({
        data: {
          pedidoId: id,
          monto,
          metodo,
          tipo: data.tipo || "saldo",
          recargo,
          porcentajeRecargo: porcRecargo,
          referencia: this.metodoRequiereReferencia(metodo) ? referencia : null,
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

    this.produccionGateway.emitPedidosActualizados({
      action: 'payment',
      pedidoId: id,
    });

    return result;
  }
}
