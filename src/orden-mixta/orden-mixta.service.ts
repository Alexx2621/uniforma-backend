import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { CorrelativosService } from "../correlativos/correlativos.service";
import { VentasService } from "../ventas/ventas.service";
import { ProduccionService } from "../produccion/produccion.service";
import { AlertasService } from "../alertas/alertas.service";

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
    private alertasService: AlertasService,
  ) {}

  private roundMoney(value: number) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private distribuirMonto(montoSolicitado: number, saldoVenta: number, saldoPedido: number) {
    const venta = this.roundMoney(Math.max(0, saldoVenta));
    const pedido = this.roundMoney(Math.max(0, saldoPedido));
    const disponible = this.roundMoney(venta + pedido);
    const monto = this.roundMoney(Math.min(Math.max(0, montoSolicitado), disponible));
    if (monto <= 0 || disponible <= 0) return { monto: 0, pagoVenta: 0, pagoPedido: 0 };

    let pagoVenta = venta > 0 && pedido > 0 ? this.roundMoney(monto * (venta / disponible)) : venta > 0 ? monto : 0;
    let pagoPedido = this.roundMoney(monto - pagoVenta);
    if (pagoVenta > venta) {
      pagoPedido = this.roundMoney(pagoPedido + pagoVenta - venta);
      pagoVenta = venta;
    }
    if (pagoPedido > pedido) {
      pagoVenta = this.roundMoney(pagoVenta + pagoPedido - pedido);
      pagoPedido = pedido;
    }
    const diferencia = this.roundMoney(monto - pagoVenta - pagoPedido);
    if (diferencia !== 0) {
      if (pedido - pagoPedido >= diferencia) pagoPedido = this.roundMoney(pagoPedido + diferencia);
      else pagoVenta = this.roundMoney(pagoVenta + diferencia);
    }
    return { monto, pagoVenta, pagoPedido };
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

  private canAutorizarOrdenMixta(user?: AuthUser) {
    return this.isAdmin(user) || this.hasPermission(user, "produccion.autorizar-pedidos");
  }

  private requiereAutorizacionOrdenMixta(subtotalPedido: number, user?: AuthUser) {
    return subtotalPedido > PEDIDO_AUTORIZACION_MONTO_MINIMO && !this.canCrearPedidoSinAutorizacion(user);
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

  private normalizarBordados(item: any) {
    const raw = Array.isArray(item?.bordados) ? item.bordados : [];
    if (raw.length) {
      return raw
        .map((bordado: any) => ({
          monto: Number(bordado?.monto || 0),
          color: `${bordado?.color || "FULL COLOR"}`.trim(),
          tamano: `${bordado?.tamano || "NORMAL"}`.trim(),
          posicion: `${bordado?.posicion || "PECHO IZQUIERDO"}`.trim(),
          observaciones: `${bordado?.observaciones || ""}`.trim(),
          imagenUrl: `${bordado?.imagenUrl || ""}` || null,
        }))
        .filter((bordado: any) => bordado.monto > 0 || bordado.observaciones || bordado.imagenUrl);
    }
    if (!item?.bordadoActivo && Number(item?.bordado || 0) <= 0) return [];
    return [{
      monto: Number(item?.bordado || 0),
      color: `${item?.bordadoColor || "FULL COLOR"}`.trim(),
      tamano: `${item?.bordadoTamano || "NORMAL"}`.trim(),
      posicion: `${item?.bordadoPosicion || "PECHO IZQUIERDO"}`.trim(),
      observaciones: `${item?.bordadoObservaciones || ""}`.trim(),
      imagenUrl: `${item?.bordadoImagenUrl || ""}` || null,
    }];
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
    const saldoDocumentos = this.roundMoney(saldoVenta + saldoPedido);
    const tieneDocumentos = Boolean(row?.venta || row?.pedido);
    const saldoGuardado = Number(row?.saldoTotal);
    const saldoTotal = tieneDocumentos
      ? saldoDocumentos
      : Number.isFinite(saldoGuardado)
        ? this.roundMoney(Math.max(0, saldoGuardado))
        : 0;

    return {
      ...row,
      envio: Number(row?.envio || 0),
      pagadoVenta: ventaPagado,
      pagadoPedido: pedidoPagado,
      pagadoTotal: this.roundMoney(ventaPagado + pedidoPagado),
      saldoVenta,
      saldoPedido,
      saldoTotal,
    };
  }

  private async getUsuariosAutorizadoresOrdenMixta() {
    const autorizadores = await this.prisma.usuario.findMany({
      where: {
        activo: true,
        OR: [
          { rol: { nombre: "ADMIN" } },
          {
            rol: {
              permisos: {
                some: {
                  permiso: { nombre: "produccion.autorizar-pedidos" },
                },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    return autorizadores.map((item) => item.id);
  }

  private async buildDetalleSolicitudOrdenMixta(detalle: any[]) {
    const productoIds = Array.from(new Set(detalle.map((item) => Number(item?.productoId || 0)).filter((id) => id > 0)));
    const productos = productoIds.length
      ? await this.prisma.producto.findMany({
          where: { id: { in: productoIds } },
          select: {
            id: true,
            codigo: true,
            nombre: true,
            tipo: true,
            genero: true,
            tela: { select: { nombre: true } },
            talla: { select: { nombre: true } },
            color: { select: { nombre: true } },
          },
        })
      : [];
    const productosMap = new Map(productos.map((producto) => [Number(producto.id), producto]));

    return detalle.map((item, index) => {
      const producto = productosMap.get(Number(item?.productoId || 0));
      return {
        linea: index + 1,
        productoId: Number(item?.productoId || 0),
        tipoOperacion: item?.tipoOperacion || "pedido",
        codigo: producto?.codigo || `${item?.productoId || "N/D"}`,
        nombre: producto?.nombre || "Producto",
        tipo: producto?.tipo || null,
        genero: producto?.genero || null,
        tela: producto?.tela?.nombre || null,
        talla: producto?.talla?.nombre || null,
        color: producto?.color?.nombre || null,
        cantidad: Number(item?.cantidad || 0),
        precioUnit: Number(item?.precioUnit || 0),
        bordado: Number(item?.bordado || 0),
        descuento: Number(item?.descuento || 0),
        subtotal: Number(item?.subtotal || this.calcularSubtotal(item)),
        observaciones: item?.descripcion || null,
      };
    });
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

      const bordados = this.normalizarBordados(item);
      const bordadoTotal = bordados.length
        ? bordados.reduce((sum: number, bordado: any) => sum + Number(bordado.monto || 0), 0)
        : Number(item?.bordado || 0);
      const normalizedItem = {
        ...item,
        productoId,
        cantidad,
        tipoOperacion,
        bodegaId,
        precioUnit: Number(item?.precioUnit ?? item?.precio ?? 0),
        bordado: bordadoTotal,
        bordadoActivo: bordados.length > 0,
        bordados,
        bordadoColor: bordados[0]?.color || null,
        bordadoTamano: bordados[0]?.tamano || null,
        bordadoPosicion: bordados[0]?.posicion || null,
        bordadoObservaciones: bordados[0]?.observaciones || null,
        bordadoImagenUrl: bordados[0]?.imagenUrl || null,
        descuento: Number(item?.descuento || 0),
        estiloEspecial: Boolean(item?.estiloEspecial),
        estiloEspecialMonto: item?.estiloEspecial ? Number(item?.estiloEspecialMonto || 0) : 0,
      };
      return { ...normalizedItem, subtotal: this.calcularSubtotal(normalizedItem) };
    });
  }

  private async aplicarPreciosCatalogo(detalle: any[]) {
    const productoIds = Array.from(new Set(detalle.map((item) => Number(item.productoId)).filter(Boolean)));
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: productoIds } },
      select: { id: true, precio: true },
    });
    const precioPorProducto = new Map(productos.map((producto) => [Number(producto.id), Number(producto.precio || 0)]));
    const faltantes = productoIds.filter((id) => !precioPorProducto.has(id));
    if (faltantes.length) {
      throw new BadRequestException(`Producto no encontrado: ${faltantes.join(", ")}`);
    }
    return detalle.map((item) => {
      const precioUnit = Number(precioPorProducto.get(Number(item.productoId)) || 0);
      const normalized = { ...item, precioUnit, precio: precioUnit };
      return {
        ...normalized,
        subtotal: this.calcularSubtotal(normalized),
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
        venta: { select: { id: true, folio: true, total: true, pagos: { select: { id: true, monto: true, metodo: true, referencia: true, banco: true, fecha: true } } } },
        pedido: {
          select: {
            id: true,
            folio: true,
            totalEstimado: true,
            anticipo: true,
            saldoPendiente: true,
            pagos: { select: { id: true, monto: true, recargo: true, metodo: true, tipo: true, referencia: true, banco: true, ubicacion: true, fecha: true } },
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
          venta: { include: { pagos: { select: { id: true, monto: true, metodo: true, referencia: true, banco: true, fecha: true } } } },
          pedido: {
            include: {
              bodega: true,
              pagos: {
                select: {
                  id: true,
                  monto: true,
                  recargo: true,
                  metodo: true,
                  referencia: true,
                  banco: true,
                  ubicacion: true,
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

      const metodo = this.normalizarMetodoPago(data?.metodo);
      const referencia = `${data?.referenciaPago || data?.referencia || ""}`.trim();
      const banco = `${data?.bancoPago || data?.banco || ""}`.trim();
      const ubicacion = this.normalizarUbicacion(data?.ubicacion || orden.ubicacion || orden.pedido?.ubicacion || orden.bodega?.ubicacion);

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
      const montoSolicitado = this.roundMoney(Number(data?.monto || 0));

      if (saldoTotal <= 0) throw new BadRequestException("La orden mixta ya no tiene saldo pendiente");
      if (montoSolicitado <= 0) throw new BadRequestException("El monto del pago debe ser mayor a 0");
      if (montoSolicitado > saldoTotal) throw new BadRequestException("El pago no puede superar el saldo pendiente");

      const { monto, pagoVenta, pagoPedido } = this.distribuirMonto(montoSolicitado, saldoVenta, saldoPedido);

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

      const nuevoSaldoTotal = this.roundMoney(Math.max(0, saldoTotal - pagoVenta - pagoPedido));
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

    const detalle = await this.aplicarPreciosCatalogo(this.normalizarDetalle(data));
    const ventaItems = detalle.filter((item) => item.tipoOperacion === "venta");
    const pedidoItems = detalle.filter((item) => item.tipoOperacion === "pedido");
    const subtotalVenta = this.roundMoney(ventaItems.reduce((sum, item) => sum + item.subtotal, 0));
    const subtotalPedido = this.roundMoney(pedidoItems.reduce((sum, item) => sum + item.subtotal, 0));
    const envio = Math.max(0, this.roundMoney(Number(data?.envio || 0)));
    const envioVenta = ventaItems.length ? envio : 0;
    const envioPedido = !ventaItems.length && pedidoItems.length ? envio : 0;
    const totalVentaDocumento = this.roundMoney(subtotalVenta + envioVenta);
    const totalPedidoDocumento = this.roundMoney(subtotalPedido + envioPedido);
    const total = this.roundMoney(totalVentaDocumento + totalPedidoDocumento);
    const anticipoTotal = this.roundMoney(Number(data?.anticipoTotal ?? data?.anticipo ?? 0));
    const metodoPago = this.normalizarMetodoPago(data?.metodoPago);
    const referenciaPago = `${data?.referenciaPago || data?.referencia || ""}`.trim();
    const bancoPago = `${data?.bancoPago || data?.banco || ""}`.trim();

    if (total <= 0) throw new BadRequestException("El total de la orden mixta debe ser mayor a 0");
    if (anticipoTotal < 0 || anticipoTotal > total) {
      throw new BadRequestException("El anticipo debe estar entre 0 y el total de la orden");
    }
    if (this.requiereAutorizacionOrdenMixta(subtotalPedido, user)) {
      throw new BadRequestException(
        `La parte de produccion de esta orden mixta es Q ${subtotalPedido.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} y supera el limite de Q ${PEDIDO_AUTORIZACION_MONTO_MINIMO.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}. Debe generarla un administrador o un usuario con permiso para crear pedidos sin autorizacion.`,
      );
    }
    if (anticipoTotal > 0 && metodoPago !== "orden_compra" && this.metodoRequiereReferencia(metodoPago) && !referenciaPago) {
      throw new BadRequestException("La referencia del pago es obligatoria para este metodo");
    }
    if (anticipoTotal > 0 && metodoPago === "deposito_bancario" && !bancoPago) {
      throw new BadRequestException("El banco es obligatorio para deposito bancario");
    }

    const { pagoVenta: anticipoVenta, pagoPedido: anticipoPedido } = this.distribuirMonto(
      anticipoTotal,
      totalVentaDocumento,
      totalPedidoDocumento,
    );
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
          envio: envioVenta,
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
          envio: envioPedido,
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
        envio,
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

  async solicitarAutorizacionOrdenMixta(data: any, user?: AuthUser & { usuario?: string | null; nombre?: string | null }, comentario?: string) {
    const usuarioId = Number(user?.id || data?.usuarioId || 0) || undefined;
    if (!usuarioId) throw new BadRequestException("No se pudo identificar el usuario solicitante");

    const detalle = await this.aplicarPreciosCatalogo(this.normalizarDetalle(data));
    const pedidoItems = detalle.filter((item) => item.tipoOperacion === "pedido");
    const subtotalPedido = this.roundMoney(pedidoItems.reduce((sum, item) => sum + item.subtotal, 0));
    if (!this.requiereAutorizacionOrdenMixta(subtotalPedido, user)) {
      throw new BadRequestException("Esta orden mixta no requiere autorizacion");
    }

    const autorizadorIds = await this.getUsuariosAutorizadoresOrdenMixta();
    if (!autorizadorIds.length) {
      throw new BadRequestException("No hay usuarios configurados para autorizar ordenes mixtas");
    }

    const payload = {
      ...data,
      detalle,
      __tipoSolicitud: "orden_mixta",
      __tipoDocumento: "orden_mixta",
      totalEstimado: this.roundMoney(detalle.reduce((sum, item) => sum + item.subtotal, 0) + Math.max(0, Number(data?.envio || 0))),
      subtotalPedido,
    };

    const solicitud = await this.prisma.pedidoProduccionAutorizacion.create({
      data: {
        solicitadoPorId: usuarioId,
        comentario: `${comentario || ""}`.trim() || null,
        payload,
      },
      include: {
        solicitadoPor: { select: { id: true, nombre: true, usuario: true } },
      },
    });

    const detalleItems = await this.buildDetalleSolicitudOrdenMixta(detalle);
    const cliente = data?.clienteNombre || "Mostrador";
    const total = Number(payload.totalEstimado || 0);
    const detalleResumen = detalleItems.length
      ? `${detalleItems.length} linea(s), ${detalleItems.reduce((sum, item) => sum + Number(item?.cantidad || 0), 0)} prenda(s)`
      : "Sin detalle";
    const solicitante = solicitud.solicitadoPor?.nombre || solicitud.solicitadoPor?.usuario || user?.usuario || "Usuario";

    await this.alertasService.crearAlertasPorUsuarios({
      usuarioIds: autorizadorIds,
      tipo: "orden_mixta_autorizacion",
      titulo: "Orden mixta pendiente de autorizacion",
      mensaje: `${solicitante} solicita autorizacion para generar una orden mixta. Cliente: ${cliente}. Total estimado: Q ${total.toFixed(2)}. Produccion: Q ${subtotalPedido.toFixed(2)}. ${detalleResumen}.`,
      payload: {
        autorizacionPedidoId: solicitud.id,
        autorizacionTipo: "orden_mixta",
        prioridad: "alta",
        solicitanteId: usuarioId,
        solicitante,
        cliente,
        total,
        subtotalPedido,
        detalleResumen,
        detalleItems,
        comentario: `${comentario || ""}`.trim() || null,
      },
    });

    return {
      id: solicitud.id,
      estado: solicitud.estado,
      autorizadores: autorizadorIds.length,
    };
  }

  async aprobarAutorizacionOrdenMixta(solicitudId: number, authUser?: AuthUser & { usuario?: string | null }, comentario?: string) {
    if (!this.canAutorizarOrdenMixta(authUser)) {
      throw new ForbiddenException("No tienes permisos para autorizar ordenes mixtas");
    }

    const solicitud = await this.prisma.pedidoProduccionAutorizacion.findUnique({
      where: { id: Number(solicitudId) },
      include: {
        solicitadoPor: { select: { id: true, rol: { select: { nombre: true } } } },
      },
    });
    if (!solicitud) throw new NotFoundException("Solicitud de autorizacion no encontrada");
    if (solicitud.estado !== "pendiente") throw new BadRequestException("Esta solicitud ya fue resuelta");
    if ((solicitud.payload as any)?.__tipoDocumento !== "orden_mixta") {
      throw new BadRequestException("Esta solicitud no pertenece a orden mixta");
    }

    let orden: any;
    try {
      orden = await this.create(solicitud.payload, {
        id: solicitud.solicitadoPorId,
        rol: solicitud.solicitadoPor?.rol?.nombre || null,
        permisos: ["produccion.crear-sin-autorizacion"],
      });
    } catch (error: any) {
      throw new BadRequestException(error?.message || "No se pudo aprobar la orden mixta");
    }

    await this.prisma.pedidoProduccionAutorizacion.update({
      where: { id: solicitud.id },
      data: {
        estado: "aprobado",
        respuestaComentario: `${comentario || ""}`.trim() || null,
        autorizadoPorId: Number(authUser?.id || 0) || null,
        pedidoId: Number(orden?.pedidoId || 0) || null,
        autorizadoEn: new Date(),
      },
    });

    await this.alertasService.crearAlertasPorUsuarios({
      usuarioIds: [solicitud.solicitadoPorId],
      tipo: "orden_mixta_autorizacion_resuelta",
      titulo: "Orden mixta autorizada",
      mensaje: `Tu solicitud fue autorizada y se genero la orden mixta ${orden?.folio || `OM-${orden?.id}`}.`,
      payload: {
        autorizacionPedidoId: solicitud.id,
        autorizacionTipo: "orden_mixta",
        ordenMixtaId: orden?.id,
        estado: "aprobado",
        prioridad: "normal",
      },
    });

    this.alertasService.emitirAutorizacionPedidoResuelta({
      solicitudId: solicitud.id,
      estado: "aprobado",
      ordenMixta: orden,
      solicitanteId: solicitud.solicitadoPorId,
    });

    return { solicitudId: solicitud.id, estado: "aprobado", ordenMixta: orden };
  }

  async rechazarAutorizacionOrdenMixta(solicitudId: number, authUser?: AuthUser, comentario?: string) {
    if (!this.canAutorizarOrdenMixta(authUser)) {
      throw new ForbiddenException("No tienes permisos para autorizar ordenes mixtas");
    }

    const solicitud = await this.prisma.pedidoProduccionAutorizacion.findUnique({
      where: { id: Number(solicitudId) },
    });
    if (!solicitud) throw new NotFoundException("Solicitud de autorizacion no encontrada");
    if (solicitud.estado !== "pendiente") throw new BadRequestException("Esta solicitud ya fue resuelta");
    if ((solicitud.payload as any)?.__tipoDocumento !== "orden_mixta") {
      throw new BadRequestException("Esta solicitud no pertenece a orden mixta");
    }

    const updated = await this.prisma.pedidoProduccionAutorizacion.update({
      where: { id: solicitud.id },
      data: {
        estado: "rechazado",
        respuestaComentario: `${comentario || ""}`.trim() || null,
        autorizadoPorId: Number(authUser?.id || 0) || null,
        autorizadoEn: new Date(),
      },
    });

    await this.alertasService.crearAlertasPorUsuarios({
      usuarioIds: [solicitud.solicitadoPorId],
      tipo: "orden_mixta_autorizacion_resuelta",
      titulo: "Orden mixta no autorizada",
      mensaje: `Tu solicitud de orden mixta fue rechazada.${updated.respuestaComentario ? ` Motivo: ${updated.respuestaComentario}` : ""}`,
      payload: {
        autorizacionPedidoId: solicitud.id,
        autorizacionTipo: "orden_mixta",
        estado: "rechazado",
        prioridad: "alta",
      },
    });

    this.alertasService.emitirAutorizacionPedidoResuelta({
      solicitudId: solicitud.id,
      estado: "rechazado",
      comentario: updated.respuestaComentario,
      solicitanteId: solicitud.solicitadoPorId,
    });

    return { solicitudId: solicitud.id, estado: "rechazado" };
  }
}
