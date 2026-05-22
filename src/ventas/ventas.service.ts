import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { CorrelativosService } from "../correlativos/correlativos.service";
import { assertBodegaAccess, getAllowedBodegaIds } from "../bodegas/bodega-access";

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

  async createVenta(data: any, usuarioId?: number | null, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
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
    if (data.bodegaId) {
      await assertBodegaAccess(this.prisma, user, Number(data.bodegaId), "ventas");
    }
    const detalleItems = Array.isArray(data.detalle) ? data.detalle : [];
    const bodegaIdsDetalle: number[] = Array.from(
      new Set(
        detalleItems
          .map((item: any) => Number(item?.bodegaId || data.bodegaId || 0))
          .filter((value: number) => Number.isFinite(value) && value > 0),
      ),
    );
    const bodegasInventario = await this.prisma.bodega.findMany({
      where: { id: { in: bodegaIdsDetalle } },
      select: { id: true, nombre: true, usaInventarioVentas: true },
    });
    const bodegaInventarioPorId = new Map(bodegasInventario.map((bodega) => [bodega.id, bodega]));
    const consumoInventario = new Map<string, { bodegaId: number; productoId: number; cantidad: number; bodegaNombre: string }>();
    for (const item of detalleItems) {
      const itemBodegaId = Number(item?.bodegaId || data.bodegaId || 0) || null;
      if (itemBodegaId) {
        await assertBodegaAccess(this.prisma, user, itemBodegaId, "ventas");
      }
      const bodegaInventario = itemBodegaId ? bodegaInventarioPorId.get(itemBodegaId) : null;
      if (!itemBodegaId || !bodegaInventario?.usaInventarioVentas) continue;
      const productoId = Number(item.productoId);
      const key = `${itemBodegaId}:${productoId}`;
      const current = consumoInventario.get(key);
      consumoInventario.set(key, {
        bodegaId: itemBodegaId,
        productoId,
        cantidad: (current?.cantidad || 0) + Number(item.cantidad || 0),
        bodegaNombre: bodegaInventario.nombre || "la bodega seleccionada",
      });
    }
    for (const item of consumoInventario.values()) {
      const inventarioActual = await this.prisma.inventario.findUnique({
        where: {
          bodegaId_productoId: {
            bodegaId: item.bodegaId,
            productoId: item.productoId,
          },
        },
        select: { stock: true },
      });
      const stockDisponible = Number(inventarioActual?.stock || 0);
      if (stockDisponible < item.cantidad) {
        throw new BadRequestException(
          `Stock insuficiente en ${item.bodegaNombre}. Disponible: ${stockDisponible}. Solicitado: ${item.cantidad}.`,
        );
      }
    }
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

    for (const item of detalleItems) {
      const itemBodegaId = Number(item.bodegaId || data.bodegaId || 0) || null;
      if (itemBodegaId) {
        await assertBodegaAccess(this.prisma, user, itemBodegaId, "ventas");
      }
      const bodegaInventario = itemBodegaId ? bodegaInventarioPorId.get(itemBodegaId) : null;
      const descontarInventario = Boolean(bodegaInventario?.usaInventarioVentas);
      const requiereTraslado = Boolean(data.bodegaId && itemBodegaId && Number(itemBodegaId) !== Number(data.bodegaId));
      const precioUnit = item.precio;
      const bordado = item.bordado ?? 0;
      const tieneBordado =
        Number(bordado || 0) > 0 ||
        Boolean(item.bordadoColor) ||
        Boolean(item.bordadoTamano) ||
        Boolean(item.bordadoPosicion) ||
        Boolean(item.bordadoImagenUrl);
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
          bodegaId: itemBodegaId,
          cantidad: item.cantidad,
          precioUnit,
          bordado,
          bordadoColor: item.bordadoColor || null,
          bordadoTamano: item.bordadoTamano || null,
          bordadoPosicion: item.bordadoPosicion || null,
          bordadoObservaciones: item.bordadoObservaciones || null,
          bordadoImagenUrl: item.bordadoImagenUrl || null,
          bordadoEstado: tieneBordado ? "EN PRODUCCION" : null,
          bordadoFechaEntrega: item.bordadoFechaEntrega ? new Date(item.bordadoFechaEntrega) : null,
          descuento,
          descripcion: item.descripcion || "",
          subtotal,
          requiereTraslado,
          trasladoEstado: requiereTraslado ? "PENDIENTE" : null,
        } as any,
      });

      if (descontarInventario && itemBodegaId) {
        // 3) Descontar inventario
        await this.prisma.inventario.update({
          where: {
            bodegaId_productoId: {
              bodegaId: itemBodegaId,
              productoId: item.productoId,
            },
          },
          data: {
            stock: {
              decrement: item.cantidad,
            },
          },
        });

        // 3b) Notificación de stock bajo
        const invUpdated = await this.prisma.inventario.findUnique({
          where: { bodegaId_productoId: { bodegaId: itemBodegaId, productoId: item.productoId } },
        });
        const threshold = Number(process.env.STOCK_ALERT_THRESHOLD || 5);
        if (invUpdated && invUpdated.stock < threshold) {
          await this.notifier.notifyLowStock([{ bodegaId: itemBodegaId, productoId: item.productoId }]);
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
        detalle: { include: { bodegaOrigen: true } },
        pagos: true,
        cliente: true,
        bodega: true,
      },
    });

    // 7) Notificación de venta alta
    await this.notifier.notifyHighSale(total, folio || `V-${venta.id}`);

    return { ...ventaActualizada, folio };
  }

  private isAdmin(user?: { rol?: string | null }) {
    return `${user?.rol || ""}`.trim().toUpperCase() === "ADMIN";
  }

  private hasPermission(user: { permisos?: string[] | null } | undefined, permission: string) {
    return Array.isArray(user?.permisos) && user.permisos.includes(permission);
  }

  private normalizeText(value?: string | null) {
    return `${value || ""}`
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  private async buildVentaWhere(user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    if (this.isAdmin(user) || this.hasPermission(user, "sistema.multi-tienda")) return {};
    if (this.hasPermission(user, "dashboard.filtro-tienda") || this.hasPermission(user, "dashboard.ver-todo")) return {};

    const currentUser = await this.prisma.usuario.findUnique({
      where: { id: Number(user?.id || 0) },
      select: { usuario: true, nombre: true, usuarioCorrelativo: true, bodegaId: true },
    });

    if (!currentUser) return { id: -1 };

    const names = [currentUser.usuario, currentUser.nombre, currentUser.usuarioCorrelativo]
      .map((value) => this.normalizeText(value))
      .filter(Boolean);
    const allowedBodegas = await getAllowedBodegaIds(this.prisma, user, "ventas");
    const filters = [
      ...(allowedBodegas === null ? [] : [{ bodegaId: { in: allowedBodegas.length ? allowedBodegas : [-1] } }]),
      ...names.map((name) => ({ vendedor: { contains: name } })),
    ];

    if (!filters.length) return { id: -1 };

    return {
      OR: filters,
    };
  }

  async findAll(user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    await this.completarFoliosPendientes();

    const ventas = await this.prisma.venta.findMany({
      where: await this.buildVentaWhere(user),
      include: {
        detalle: { include: { bodegaOrigen: true } },
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
