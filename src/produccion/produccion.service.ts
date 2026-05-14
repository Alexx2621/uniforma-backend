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
        crossStoreRoleIds: true,
      },
    });

    return {
      pedidoAlertRoleIds: this.normalizeRoleIds(config?.pedidoAlertRoleIds),
      crossStoreRoleIds: this.normalizeRoleIds(config?.crossStoreRoleIds),
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

  private metodoPermiteSinAnticipo(value?: string | null) {
    return this.normalizarMetodoPago(value) === "orden_compra";
  }

  private normalizarPostventaCobro(value?: string | null) {
    const normalized = `${value || "normal"}`.trim().toLowerCase();
    return normalized === "sin_cobro" ? "sin_cobro" : "normal";
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

  private getPagoAplicado(pago: any) {
    return Number(pago?.monto || 0) + Number(pago?.recargo || 0);
  }

  private resolverSaldoPendientePedido(pedido: any) {
    const saldoGuardado = Number(pedido?.saldoPendiente || 0);
    if (saldoGuardado > 0) return saldoGuardado;

    const total = Number(pedido?.totalEstimado || 0);
    const anticipo = Number(pedido?.anticipo || 0);
    const pagado = Array.isArray(pedido?.pagos)
      ? pedido.pagos.reduce((sum: number, pago: any) => sum + this.getPagoAplicado(pago), 0)
      : 0;

    return Math.max(0, total - Math.max(anticipo, pagado));
  }

  private normalizePedidoResponse(pedido: any) {
    if (!pedido) return pedido;
    const saldoPendiente = this.resolverSaldoPendientePedido(pedido);
    return {
      ...pedido,
      ubicacion: this.resolverUbicacionPedido(pedido),
      totalEstimado: Number(pedido?.totalEstimado || 0),
      anticipo: Number(pedido?.anticipo || 0),
      saldoPendiente,
      recargo: Number(pedido?.recargo || 0),
      porcentajeRecargo: Number(pedido?.porcentajeRecargo || 0),
      envio: Number(pedido?.envio || 0),
      unificado: Array.isArray(pedido?.unificaciones) && pedido.unificaciones.length > 0,
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

  private normalizarUbicacion(value: any) {
    const normalized = `${value || "TIENDA"}`.trim().toUpperCase();
    if (normalized.includes("CAPITAL")) return "CAPITAL";
    if (normalized.includes("DEPART")) return "DEPARTAMENTO";
    if (normalized.includes("ANTIGUA")) return "DEPARTAMENTO";
    return "TIENDA";
  }

  private isAdmin(user?: { rol?: string | null }) {
    return `${user?.rol || ""}`.trim().toUpperCase() === "ADMIN";
  }

  private async buildPedidoUsuarioWhere(user?: { id?: number; rol?: string | null; rolId?: number | null }) {
    const systemConfig = await this.getSystemConfig();
    const canAccessAll = this.isAdmin(user) || systemConfig.crossStoreRoleIds.includes(Number(user?.rolId || 0));
    if (canAccessAll) return {};

    const usuarioId = Number(user?.id || 0);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      return { id: -1 };
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, nombre: true, usuario: true, usuarioCorrelativo: true },
    });
    const nombreParts = `${usuario?.nombre || ""}`.trim().split(/\s+/).filter(Boolean);
    const nombres = Array.from(
      new Set(
        [
          usuario?.usuario,
          usuario?.usuario?.replace(/[._-]+/g, " "),
          usuario?.nombre,
          usuario?.usuarioCorrelativo,
          nombreParts.length >= 2 ? `${nombreParts[0]} ${nombreParts[1]}` : null,
        ]
          .map((value) => `${value || ""}`.trim())
          .filter(Boolean),
      ),
    );

    return {
      OR: [
        { usuarioId },
        ...(nombres.length
          ? [
              {
                usuarioId: null,
                OR: nombres.map((nombre) => ({ solicitadoPor: { contains: nombre } })),
              },
            ]
          : []),
      ],
    };
  }

  private resolverUbicacionPedido(pedido: any) {
    if (`${pedido?.ubicacion || ""}`.trim()) {
      return this.normalizarUbicacion(pedido.ubicacion);
    }
    const fallback = `${pedido?.bodega?.ubicacion || pedido?.bodega?.nombre || ""}`.trim();
    return this.normalizarUbicacion(fallback || "TIENDA");
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

  async crearPedido(data: any, usuarioId?: number, user?: { id?: number; rol?: string | null }) {
    const systemConfig = await this.getSystemConfig();
    const pedidoAlertRoleIds = this.normalizeRoleIds((systemConfig as any).pedidoAlertRoleIds);
    const pedidoParaStockGlobal = this.normalizarMetodoPago(data?.metodoPago) === "sin_cobro_stock";
    if (!pedidoParaStockGlobal) {
      await this.assertClienteCartera(Number(data?.clienteId || 0) || null, user);
    }

    const pedido = await this.prisma.$transaction(async (tx) => {
      const detalles = data.detalle || [];
      const metodoPago = this.normalizarMetodoPago(data.metodoPago);
      const pedidoParaStock = metodoPago === "sin_cobro_stock";
      const referencia = `${data?.referenciaPago || data?.referencia || ""}`.trim();
      const banco = `${data?.bancoPago || data?.banco || ""}`.trim();
      const clienteNombre = pedidoParaStock ? "Pedido para stock" : `${data?.clienteNombre || ""}`.trim();
      const clienteTelefono = pedidoParaStock ? "" : `${data?.clienteTelefono || ""}`.trim();
      const ubicacion = this.normalizarUbicacion(data?.ubicacion);
      const postventaId = Number(data?.postventaId || 0) || null;
      const postventaCobro = this.normalizarPostventaCobro(data?.postventaCobro);
      const pedidoSinCobro = postventaCobro === "sin_cobro" || metodoPago === "sin_cobro" || pedidoParaStock;
      if (pedidoSinCobro && !pedidoParaStock && !postventaId) {
        throw new Error("Selecciona el documento de cambio/devolucion para crear un pedido sin valor monetario");
      }
      if (postventaId) {
        const postventa = await tx.cambioDevolucion.findUnique({
          where: { id: postventaId },
          select: { id: true, folio: true, estado: true },
        });
        if (!postventa) {
          throw new Error("El documento de cambio/devolucion seleccionado no existe");
        }
        if (`${postventa.estado || ""}`.trim().toLowerCase() === "anulado") {
          throw new Error("No se puede vincular un documento de cambio/devolucion anulado");
        }
      }
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
      const envio = Math.max(0, Number(data.envio || 0));
      const totalCalculado = subtotal + recargo + envio;
      const totalEstimado = pedidoSinCobro ? 0 : totalCalculado;
      const anticipo = pedidoSinCobro ? 0 : Number(data.anticipo) || 0;

      if (!pedidoSinCobro && anticipo <= 0 && !this.metodoPermiteSinAnticipo(metodoPago)) {
        throw new Error("Debes registrar un anticipo mayor a 0");
      }
      if (anticipo > totalEstimado) {
        throw new Error(
          `El anticipo (Q ${Number(anticipo || 0).toFixed(2)}) no puede superar el total (Q ${totalEstimado.toFixed(2)}).`
        );
      }
      if (!pedidoSinCobro && this.metodoRequiereReferencia(metodoPago) && !referencia) {
        throw new Error("La referencia del pago es obligatoria para este metodo");
      }
      if (!pedidoSinCobro && metodoPago === "deposito_bancario" && !banco) {
        throw new Error("El banco es obligatorio para deposito bancario");
      }

      const folio = await this.generarCorrelativoUsuarioOperacion(tx, usuarioId, "pedido", "PE");
      const pedido = await tx.pedidoProduccion.create({
        data: {
          folio,
          solicitadoPor: data.solicitadoPor || null,
          observaciones: data.observaciones || null,
          clienteId: pedidoParaStock ? null : data.clienteId || null,
          clienteNombre: clienteNombre || "Mostrador",
          clienteTelefono: clienteTelefono || null,
          usuarioId: Number(usuarioId || 0) || null,
          bodegaId: data.bodegaId || null,
          totalEstimado,
          anticipo,
          saldoPendiente: totalEstimado - anticipo,
          recargo: pedidoSinCobro ? 0 : recargo,
          porcentajeRecargo: pedidoSinCobro ? 0 : porcRecargo,
          envio: pedidoSinCobro ? 0 : envio,
          metodoPago: pedidoParaStock ? "sin_cobro_stock" : pedidoSinCobro ? "sin_cobro" : metodoPago,
          postventaId: pedidoParaStock ? null : postventaId,
          postventaCobro: pedidoParaStock ? "normal" : postventaCobro,
        },
      });

      await tx.$executeRaw`UPDATE PedidoProduccion SET ubicacion = ${ubicacion} WHERE id = ${pedido.id}`;

      for (const item of detalles) {
        await tx.detallePedidoProduccion.create({
          data: {
            pedidoId: pedido.id,
            productoId: item.productoId,
            cantidad: Number(item.cantidad) || 0,
            precioUnit: pedidoParaStock ? 0 : Number(item.precioUnit) || 0,
            bordado: pedidoParaStock ? 0 : Number(item.bordado) || 0,
            estiloEspecial: pedidoParaStock ? false : Boolean(item.estiloEspecial),
            estiloEspecialMonto: pedidoParaStock || !item.estiloEspecial ? 0 : Number(item.estiloEspecialMonto) || 0,
            descuento: pedidoParaStock ? 0 : Number(item.descuento) || 0,
            descripcion: item.descripcion || "",
          },
        });
      }

      if (anticipo > 0) {
        const pago = await tx.pagoPedido.create({
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
        if (metodoPago === "deposito_bancario" && banco) {
          await tx.$executeRaw`UPDATE PagoPedido SET banco = ${banco} WHERE id = ${pago.id}`;
        }
      }

      return tx.pedidoProduccion.findUnique({
        where: { id: pedido.id },
        select: {
          id: true,
          folio: true,
          fecha: true,
          estado: true,
          solicitadoPor: true,
          observaciones: true,
          clienteId: true,
          clienteNombre: true,
          clienteTelefono: true,
          usuarioId: true,
          bodegaId: true,
          totalEstimado: true,
          anticipo: true,
          saldoPendiente: true,
          recargo: true,
          porcentajeRecargo: true,
          envio: true,
          metodoPago: true,
          postventaId: true,
          postventaCobro: true,
          cliente: true,
          usuario: true,
          bodega: true,
          postventa: true,
        },
      });
    });

    if (pedido) {
      (pedido as any).ubicacion = this.normalizarUbicacion(data?.ubicacion);
      await this.crearAlertasNuevoPedido(pedido, data, pedidoAlertRoleIds);
      this.produccionGateway.emitPedidosActualizados({
        action: 'created',
        pedidoId: pedido.id,
      });
    }

    return pedido;
  }

  async listarPedidos(user?: { id?: number; rol?: string | null }) {
    const where = await this.buildPedidoUsuarioWhere(user);
    const pedidos = await this.prisma.pedidoProduccion.findMany({
      where,
      include: {
        detalle: { include: { producto: true } },
        avances: true,
        mermas: true,
        pagos: true,
        cliente: true,
        usuario: { select: { id: true, nombre: true, usuario: true } },
        bodega: true,
        postventa: true,
        unificaciones: { select: { produccionUnificadoId: true } },
      },
      orderBy: { id: "desc" },
    });
    const ubicaciones = await this.prisma.$queryRaw<Array<{ id: number; ubicacion: string | null }>>`
      SELECT id, ubicacion FROM PedidoProduccion
    `;
    const bancosPago = await this.prisma.$queryRaw<Array<{ id: number; banco: string | null }>>`
      SELECT id, banco FROM PagoPedido
    `;
    const ubicacionById = new Map(ubicaciones.map((row) => [Number(row.id), row.ubicacion]));
    const bancoPagoById = new Map(bancosPago.map((row) => [Number(row.id), row.banco]));
    return pedidos.map((pedido) =>
      this.normalizePedidoResponse({
        ...pedido,
        ubicacion: ubicacionById.get(Number(pedido.id)) || null,
        pagos: Array.isArray(pedido.pagos)
          ? pedido.pagos.map((pago: any) => ({
              ...pago,
              banco: bancoPagoById.get(Number(pago.id)) || null,
            }))
          : [],
      }),
    );
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
        postventa: true,
        unificaciones: { select: { produccionUnificadoId: true } },
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

  async regresarPedido(id: number, data?: { motivo?: string; observaciones?: string }) {
    const pedido = await this.prisma.pedidoProduccion.findUnique({
      where: { id },
    });

    if (!pedido) throw new Error(`Pedido ${id} no existe`);

    const estado = `${pedido.estado || ""}`.trim().toLowerCase();
    if (estado === "anulado") {
      throw new Error("No se puede regresar un pedido anulado");
    }
    if (!["recibido", "completado", "pendiente_pago"].includes(estado)) {
      throw new Error("Solo se puede regresar un pedido recibido o pendiente de pago");
    }

    const motivo = `${data?.motivo || data?.observaciones || ""}`.trim();
    await this.prisma.pedidoProduccion.update({
      where: { id },
      data: {
        estado: "regresado_produccion",
        observaciones: motivo || pedido.observaciones,
      },
    });

    this.produccionGateway.emitPedidosActualizados({
      action: 'returned',
      pedidoId: id,
    });

    return { mensaje: "Pedido regresado por inconformidades de produccion" };
  }

  async terminarPedido(id: number, data: any) {
    const result = await this.prisma.$transaction(async (tx) => {
      const pedido = await tx.pedidoProduccion.findUnique({
        where: { id },
        include: { detalle: true },
      });
      if (!pedido) throw new Error(`Pedido ${id} no existe`);

      await tx.pedidoProduccion.update({
        where: { id },
        data: {
          estado: Number(pedido.saldoPendiente || 0) > 0 ? "pendiente_pago" : "recibido",
          observaciones: data.observaciones || null,
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
      const pedido = await tx.pedidoProduccion.findUnique({ where: { id }, include: { pagos: true } });
      if (!pedido) throw new Error(`Pedido ${id} no existe`);

      const monto = Number(data.monto) || 0;
      const metodo = this.normalizarMetodoPago(data.metodo);
      const referencia = `${data.referenciaPago || data.referencia || ""}`.trim();
      const porcRecargo = this.metodoUsaRecargo(metodo) ? Number(data.porcentajeRecargo || 0) : 0;
      const recargo = monto * (porcRecargo / 100);
      const aplicado = monto + recargo;
      const saldoActual = this.resolverSaldoPendientePedido(pedido);
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
          estado: nuevoSaldo <= 0 && pedido.estado === "pendiente_pago" ? "recibido" : pedido.estado,
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
