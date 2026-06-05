import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { CorrelativosService } from "../correlativos/correlativos.service";
import { VentasService } from "../ventas/ventas.service";
import { ProduccionService } from "../produccion/produccion.service";

const PEDIDO_AUTORIZACION_MONTO_MINIMO = 3000;

type AuthUser = {
  id?: number;
  rol?: string | null;
  permisos?: string[] | null;
  bodegaId?: number | string | null;
};

@Injectable()
export class OrdenMixtaService {
  constructor(
    private prisma: PrismaService,
    private correlativos: CorrelativosService,
    private ventasService: VentasService,
    private produccionService: ProduccionService,
  ) {}

  private roundMoney(value: number) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private normalizarMetodoPago(value?: string | null) {
    return `${value || "efectivo"}`.trim().toLowerCase();
  }

  private normalizarUbicacion(value?: string | null) {
    const normalized = `${value || "TIENDA"}`.trim().toUpperCase();
    if (normalized.includes("CAPITAL")) return "CAPITAL";
    if (normalized.includes("DEPART")) return "DEPARTAMENTO";
    if (normalized.includes("ANTIGUA")) return "DEPARTAMENTO";
    return "TIENDA";
  }

  private metodoRequiereReferencia(value?: string | null) {
    return this.normalizarMetodoPago(value) !== "efectivo";
  }

  private isAdmin(user?: AuthUser) {
    return `${user?.rol || ""}`.trim().toUpperCase() === "ADMIN";
  }

  private hasPermission(user: AuthUser | undefined, permission: string) {
    return Array.isArray(user?.permisos) && user.permisos.includes(permission);
  }

  private canCrearPedidoSinAutorizacion(user?: AuthUser) {
    return (
      this.isAdmin(user) ||
      this.hasPermission(user, "produccion.autorizar-pedidos") ||
      this.hasPermission(user, "produccion.crear-sin-autorizacion")
    );
  }

  private calcularSubtotal(item: any) {
    const cantidad = Number(item?.cantidad || 0);
    const precio = Number(item?.precioUnit ?? item?.precio ?? 0);
    const bordado = Number(item?.bordado || 0);
    const descuento = Number(item?.descuento || 0);
    const estiloEspecialMonto = item?.estiloEspecial ? Number(item?.estiloEspecialMonto || 0) : 0;
    const precioConDescuento = (precio + estiloEspecialMonto) * (1 - descuento / 100);
    return this.roundMoney(cantidad * (precioConDescuento + bordado));
  }

  private getVentaPagado(venta: any) {
    return Array.isArray(venta?.pagos)
      ? this.roundMoney(venta.pagos.reduce((sum: number, pago: any) => sum + Number(pago?.monto || 0), 0))
      : 0;
  }

  private getPedidoPagado(pedido: any) {
    return Array.isArray(pedido?.pagos)
      ? this.roundMoney(pedido.pagos.reduce((sum: number, pago: any) => sum + Number(pago?.monto || 0) + Number(pago?.recargo || 0), 0))
      : Number(pedido?.anticipo || 0);
  }

  private async safeSetPagoPedidoUbicacion(tx: any, pagoId: number, ubicacion: string) {
    try {
      await tx.$executeRaw`UPDATE PagoPedido SET ubicacion = ${ubicacion} WHERE id = ${pagoId}`;
    } catch (error) {
      console.warn("No se pudo guardar ubicacion de PagoPedido; verifica migracion PagoPedido.ubicacion", error);
    }
  }

  private normalizeOrden(row: any) {
    const ventaPagado = this.getVentaPagado(row?.venta);
    const ventaTotal = Number(row?.venta?.total || 0);
    const saldoVenta = this.roundMoney(Math.max(0, ventaTotal - ventaPagado));
    const pedidoPagado = this.getPedidoPagado(row?.pedido);
    const saldoPedidoGuardado = Number(row?.pedido?.saldoPendiente || 0);
    const saldoPedido = this.roundMoney(
      Math.max(0, saldoPedidoGuardado > 0 ? saldoPedidoGuardado : Number(row?.pedido?.totalEstimado || 0) - pedidoPagado),
    );
    const saldoTotal = this.roundMoney(saldoVenta + saldoPedido);

    return {
      ...row,
      pagadoVenta: ventaPagado,
      pagadoPedido: pedidoPagado,
      pagadoTotal: this.roundMoney(ventaPagado + pedidoPagado),
      saldoVenta,
      saldoPedido,
      saldoTotal,
    };
  }

  private normalizarDetalle(data: any) {
    const detalle = Array.isArray(data?.detalle) ? data.detalle : [];
    if (!detalle.length) {
      throw new BadRequestException("Agrega al menos una linea a la orden mixta");
    }

    return detalle.map((item: any, index: number) => {
      const productoId = Number(item?.productoId || 0);
      const cantidad = Number(item?.cantidad || 0);
      const tipoOperacion = `${item?.tipoOperacion || item?.operacion || ""}`.trim().toLowerCase();
      const bodegaId = Number(item?.bodegaId || data?.bodegaId || 0) || null;
      if (!Number.isInteger(productoId) || productoId <= 0) {
        throw new BadRequestException(`La linea ${index + 1} no tiene producto valido`);
      }
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw new BadRequestException(`La linea ${index + 1} debe tener cantidad mayor a 0`);
      }
      if (!["venta", "pedido"].includes(tipoOperacion)) {
        throw new BadRequestException(`Selecciona si la linea ${index + 1} sale de inventario o va a produccion`);
      }
      if (tipoOperacion === "venta" && !bodegaId) {
        throw new BadRequestException(`La linea ${index + 1} necesita bodega origen para rebajar inventario`);
      }

      return {
        ...item,
        productoId,
        cantidad,
        tipoOperacion,
        bodegaId,
        precioUnit: Number(item?.precioUnit ?? item?.precio ?? 0),
        bordado: Number(item?.bordado || 0),
        descuento: Number(item?.descuento || 0),
        estiloEspecial: Boolean(item?.estiloEspecial),
        estiloEspecialMonto: item?.estiloEspecial ? Number(item?.estiloEspecialMonto || 0) : 0,
        subtotal: this.calcularSubtotal(item),
      };
    });
  }

  async findAll(user?: AuthUser, query: any = {}) {
    const where: any = {};
    if (!this.isAdmin(user) && !this.hasPermission(user, "sistema.multi-tienda")) {
      where.usuarioId = Number(user?.id || 0) || -1;
    }
    if (query?.desde || query?.hasta) {
      where.fecha = {};
      if (query.desde) where.fecha.gte = new Date(`${query.desde}T00:00:00`);
      if (query.hasta) where.fecha.lte = new Date(`${query.hasta}T23:59:59.999`);
    }

    const rows = await this.prisma.ordenMixta.findMany({
      where,
      orderBy: { fecha: "desc" },
      include: {
        cliente: { select: { id: true, nombre: true, telefono: true } },
        bodega: { select: { id: true, nombre: true } },
        usuario: { select: { id: true, nombre: true, usuario: true } },
        venta: { select: { id: true, folio: true, total: true, pagos: { select: { id: true, monto: true, metodo: true, fecha: true } } } },
        pedido: {
          select: {
            id: true,
            folio: true,
            totalEstimado: true,
            anticipo: true,
            saldoPendiente: true,
            pagos: { select: { id: true, monto: true, recargo: true, metodo: true, tipo: true, fecha: true } },
          },
        },
        detalle: {
          include: {
            producto: {
              include: {
                tela: true,
                talla: true,
                color: true,
              },
            },
            bodega: { select: { id: true, nombre: true } },
          },
        },
      },
    });

    return rows.map((row) => this.normalizeOrden(row));
  }

  async findOne(id: number, user?: AuthUser) {
    const rows = await this.findAll(user);
    const found = rows.find((row) => Number(row.id) === Number(id));
    if (!found) throw new BadRequestException("Orden mixta no encontrada");
    return found;
  }

  async registrarPago(id: number, data: any, user?: AuthUser) {
    const result = await this.prisma.$transaction(async (tx) => {
      const orden = await tx.ordenMixta.findUnique({
        where: { id: Number(id) },
        include: {
          venta: { include: { pagos: { select: { id: true, monto: true, metodo: true, fecha: true } } } },
          pedido: {
            include: {
              bodega: true,
              pagos: {
                select: {
                  id: true,
                  monto: true,
                  recargo: true,
                  metodo: true,
                  tipo: true,
                  fecha: true,
                },
              },
            },
          },
          bodega: true,
        },
      });

      if (!orden) throw new BadRequestException("Orden mixta no encontrada");
      if (!this.isAdmin(user) && !this.hasPermission(user, "sistema.multi-tienda") && Number(orden.usuarioId || 0) !== Number(user?.id || 0)) {
        throw new BadRequestException("No tienes acceso a esta orden mixta");
      }

      const monto = this.roundMoney(Number(data?.monto || 0));
      const metodo = this.normalizarMetodoPago(data?.metodo);
      const referencia = `${data?.referenciaPago || data?.referencia || ""}`.trim();
      const banco = `${data?.bancoPago || data?.banco || ""}`.trim();
      const ubicacion = this.normalizarUbicacion(data?.ubicacion || orden.ubicacion || orden.pedido?.ubicacion || orden.bodega?.ubicacion);

      if (monto <= 0) throw new BadRequestException("Monto invalido");
      if (this.metodoRequiereReferencia(metodo) && !referencia) {
        throw new BadRequestException("La referencia del pago es obligatoria para este metodo");
      }
      if (metodo === "deposito_bancario" && !banco) {
        throw new BadRequestException("El banco es obligatorio para deposito bancario");
      }

      const ventaPagado = this.getVentaPagado(orden.venta);
      const saldoVenta = this.roundMoney(Math.max(0, Number(orden.venta?.total || 0) - ventaPagado));
      const saldoPedido = this.roundMoney(Math.max(0, Number(orden.pedido?.saldoPendiente || 0)));
      const saldoTotal = this.roundMoney(saldoVenta + saldoPedido);

      if (saldoTotal <= 0) throw new BadRequestException("La orden mixta ya no tiene saldo pendiente");
      if (monto > saldoTotal) {
        throw new BadRequestException(`El pago no puede superar el saldo pendiente Q ${saldoTotal.toFixed(2)}`);
      }

      let pagoVenta = 0;
      let pagoPedido = 0;
      if (saldoVenta > 0 && saldoPedido > 0) {
        pagoVenta = this.roundMoney(monto * (saldoVenta / saldoTotal));
        pagoPedido = this.roundMoney(monto - pagoVenta);
      } else if (saldoVenta > 0) {
        pagoVenta = monto;
      } else {
        pagoPedido = monto;
      }

      if (pagoVenta > saldoVenta) {
        pagoPedido = this.roundMoney(pagoPedido + (pagoVenta - saldoVenta));
        pagoVenta = saldoVenta;
      }
      if (pagoPedido > saldoPedido) {
        pagoVenta = this.roundMoney(pagoVenta + (pagoPedido - saldoPedido));
        pagoPedido = saldoPedido;
      }

      if (pagoVenta > 0 && orden.ventaId) {
        await tx.pagoVenta.create({
          data: {
            ventaId: orden.ventaId,
            monto: pagoVenta,
            metodo,
            referencia: this.metodoRequiereReferencia(metodo) ? referencia : null,
            banco: metodo === "deposito_bancario" ? banco : null,
          },
        });
      }

      if (pagoPedido > 0 && orden.pedidoId) {
        const pago = await tx.pagoPedido.create({
          data: {
            pedidoId: orden.pedidoId,
            monto: pagoPedido,
            metodo,
            tipo: data?.tipo || "saldo",
            recargo: 0,
            porcentajeRecargo: 0,
            referencia: this.metodoRequiereReferencia(metodo) ? referencia : null,
            banco: metodo === "deposito_bancario" ? banco : null,
            numeroEnvio: `${data?.numeroEnvio || ""}`.trim() || null,
            numeroRecibo: `${data?.numeroRecibo || ""}`.trim() || null,
            referenciaDocumento: `${data?.referenciaDocumento || ""}`.trim() || null,
            observacionesPago: `${data?.observacionesPago || ""}`.trim() || null,
          },
          select: { id: true },
        });
        await this.safeSetPagoPedidoUbicacion(tx, pago.id, ubicacion);

        const nuevoSaldoPedido = this.roundMoney(Math.max(0, saldoPedido - pagoPedido));
        await tx.pedidoProduccion.update({
          where: { id: orden.pedidoId },
          data: {
            saldoPendiente: nuevoSaldoPedido,
            estado: nuevoSaldoPedido <= 0 && `${orden.pedido?.estado || ""}`.trim().toLowerCase() !== "anulado" ? "recibido" : orden.pedido?.estado,
          },
        });
      }

      const nuevoSaldoTotal = this.roundMoney(Math.max(0, saldoTotal - monto));
      await tx.ordenMixta.update({
        where: { id: orden.id },
        data: {
          anticipoTotal: { increment: monto },
          anticipoVenta: { increment: pagoVenta },
          anticipoPedido: { increment: pagoPedido },
          saldoTotal: nuevoSaldoTotal,
          estado: nuevoSaldoTotal <= 0 ? "pagada" : "pendiente_pago",
        },
      });

      return { pagoVenta, pagoPedido, saldoTotal: nuevoSaldoTotal };
    });

    return {
      ...result,
      orden: await this.findOne(id, user),
    };
  }

  async create(data: any, user?: AuthUser) {
    const usuarioId = Number(user?.id || data?.usuarioId || 0) || undefined;
    if (!usuarioId) throw new BadRequestException("No se pudo identificar el usuario");

    const detalle = this.normalizarDetalle(data);
    const ventaItems = detalle.filter((item) => item.tipoOperacion === "venta");
    const pedidoItems = detalle.filter((item) => item.tipoOperacion === "pedido");
    const subtotalVenta = this.roundMoney(ventaItems.reduce((sum, item) => sum + item.subtotal, 0));
    const subtotalPedido = this.roundMoney(pedidoItems.reduce((sum, item) => sum + item.subtotal, 0));
    const total = this.roundMoney(subtotalVenta + subtotalPedido);
    const anticipoTotal = this.roundMoney(Number(data?.anticipoTotal ?? data?.anticipo ?? 0));
    const metodoPago = this.normalizarMetodoPago(data?.metodoPago);
    const referenciaPago = `${data?.referenciaPago || data?.referencia || ""}`.trim();
    const bancoPago = `${data?.bancoPago || data?.banco || ""}`.trim();

    if (total <= 0) throw new BadRequestException("El total de la orden mixta debe ser mayor a 0");
    if (anticipoTotal < 0 || anticipoTotal > total) {
      throw new BadRequestException("El anticipo debe estar entre 0 y el total de la orden");
    }
    if (subtotalPedido > PEDIDO_AUTORIZACION_MONTO_MINIMO && !this.canCrearPedidoSinAutorizacion(user)) {
      throw new BadRequestException("La parte de produccion supera Q 3,000 y necesita autorizacion antes de generarse");
    }
    if (this.metodoRequiereReferencia(metodoPago) && !referenciaPago) {
      throw new BadRequestException("La referencia del pago es obligatoria para este metodo");
    }
    if (metodoPago === "deposito_bancario" && !bancoPago) {
      throw new BadRequestException("El banco es obligatorio para deposito bancario");
    }

    const anticipoVenta =
      subtotalVenta > 0 && subtotalPedido > 0
        ? this.roundMoney(anticipoTotal * (subtotalVenta / total))
        : subtotalVenta > 0
          ? anticipoTotal
          : 0;
    const anticipoPedido = this.roundMoney(Math.max(0, anticipoTotal - anticipoVenta));
    if (subtotalPedido > 0 && anticipoPedido <= 0 && metodoPago !== "orden_compra") {
      throw new BadRequestException("El pedido de produccion necesita un anticipo mayor a 0");
    }

    const clienteNombre = `${data?.clienteNombre || "CF"}`.trim() || "CF";
    const clienteTelefono = `${data?.clienteTelefono || ""}`.trim() || null;
    const bodegaId = Number(data?.bodegaId || 0) || null;
    const ubicacion = `${data?.ubicacion || "TIENDA"}`.trim().toUpperCase();
    const vendedor = `${data?.vendedor || data?.solicitadoPor || ""}`.trim() || null;
    const observaciones = `${data?.observaciones || ""}`.trim() || null;
    const folioResp = await this.correlativos.generarUsuarioOperacionCorrelativo(usuarioId, "ordenMixta");
    const folio = folioResp.correlativo;

    let ventaCreada: any = null;
    let pedidoCreado: any = null;

    if (ventaItems.length) {
      ventaCreada = await this.ventasService.createVenta(
        {
          clienteId: data?.clienteId || null,
          clienteNombre,
          clienteTelefono,
          metodoPago,
          referenciaPago,
          bancoPago,
          ubicacion,
          bodegaId,
          vendedor,
          envio: 0,
          montoPago: anticipoVenta,
          observaciones: observaciones ? `${folio}: ${observaciones}` : folio,
          detalle: ventaItems.map((item) => ({
            ...item,
            precio: item.precioUnit,
            bodegaId: item.bodegaId || bodegaId,
            descripcion: item.descripcion || observaciones || "",
          })),
        },
        usuarioId,
        user,
      );
    }

    if (pedidoItems.length) {
      pedidoCreado = await this.produccionService.crearPedido(
        {
          clienteId: data?.clienteId || null,
          clienteNombre,
          clienteTelefono,
          metodoPago,
          referenciaPago,
          bancoPago,
          ubicacion,
          bodegaId,
          solicitadoPor: vendedor,
          anticipo: anticipoPedido,
          envio: 0,
          observaciones: observaciones ? `${folio}: ${observaciones}` : folio,
          detalle: pedidoItems.map((item) => ({
            ...item,
            precioUnit: item.precioUnit,
            descripcion: item.descripcion || observaciones || "",
          })),
        },
        usuarioId,
        user,
      );
    }

    const orden = await this.prisma.ordenMixta.create({
      data: {
        folio,
        clienteId: data?.clienteId || null,
        clienteNombre,
        clienteTelefono,
        usuarioId,
        bodegaId,
        vendedor,
        ubicacion,
        metodoPago,
        referenciaPago: referenciaPago || null,
        bancoPago: metodoPago === "deposito_bancario" ? bancoPago || null : null,
        subtotalVenta,
        subtotalPedido,
        total,
        anticipoTotal,
        anticipoVenta,
        anticipoPedido,
        saldoTotal: this.roundMoney(total - anticipoTotal),
        ventaId: ventaCreada?.id || null,
        pedidoId: pedidoCreado?.id || null,
        observaciones,
        detalle: {
          create: detalle.map((item) => ({
            productoId: item.productoId,
            tipoOperacion: item.tipoOperacion,
            bodegaId: item.bodegaId,
            cantidad: item.cantidad,
            precioUnit: item.precioUnit,
            bordado: item.bordado,
            descuento: item.descuento,
            estiloEspecial: item.estiloEspecial,
            estiloEspecialMonto: item.estiloEspecialMonto,
            descripcion: item.descripcion || null,
            subtotal: item.subtotal,
          })),
        },
      },
      include: {
        venta: { select: { id: true, folio: true, total: true } },
        pedido: { select: { id: true, folio: true, totalEstimado: true, anticipo: true, saldoPendiente: true } },
        detalle: true,
      },
    });

    return orden;
  }
}
