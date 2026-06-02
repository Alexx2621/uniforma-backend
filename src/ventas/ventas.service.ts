import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { CorrelativosService } from "../correlativos/correlativos.service";
import { assertBodegaAccess, getAllowedBodegaIds } from "../bodegas/bodega-access";
import { paginatedResponse, parseBooleanQuery, parsePaginationQuery } from "../common/pagination";

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

  private async assertVentaBodegaDocumento(
    ventaBodegaId: number,
    user?: { id?: number; rol?: string | null; permisos?: string[] | null; bodegaId?: number | string | null },
  ) {
    if (this.isAdmin(user)) return;
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: Number(user?.id || 0) },
      select: { bodegaId: true },
    });
    const bodegaPrincipalId = Number(usuario?.bodegaId || user?.bodegaId || 0);
    if (!bodegaPrincipalId) {
      throw new BadRequestException("Tu usuario no tiene una bodega principal asignada para registrar ventas");
    }
    if (Number(ventaBodegaId) !== bodegaPrincipalId) {
      throw new BadRequestException("La bodega de la venta debe ser la bodega principal asignada al usuario");
    }
  }

  private normalizarDetalleVenta(data: any) {
    const detalleItems = Array.isArray(data?.detalle) ? data.detalle : [];
    if (!detalleItems.length) {
      throw new BadRequestException("Agrega al menos un producto a la venta");
    }

    return detalleItems.map((item: any, index: number) => {
      const productoId = Number(item?.productoId || 0);
      const cantidad = Number(item?.cantidad || 0);
      const bodegaId = Number(item?.bodegaId || data?.bodegaId || 0) || null;
      const bordados = (Array.isArray(item?.bordados) ? item.bordados : [])
        .map((bordado: any) => ({
          monto: Number(bordado?.monto ?? bordado?.bordado ?? 0) || 0,
          color: `${bordado?.color ?? bordado?.bordadoColor ?? ""}`.trim(),
          tamano: `${bordado?.tamano ?? bordado?.bordadoTamano ?? ""}`.trim(),
          posicion: `${bordado?.posicion ?? bordado?.bordadoPosicion ?? ""}`.trim(),
          observaciones: `${bordado?.observaciones ?? bordado?.bordadoObservaciones ?? ""}`.trim(),
          imagenUrl: bordado?.imagenUrl || bordado?.bordadoImagenUrl || null,
        }))
        .filter((bordado) => bordado.monto > 0 || Boolean(bordado.observaciones) || Boolean(bordado.imagenUrl));
      const primerBordado = bordados[0] || null;
      const totalBordado = bordados.length
        ? bordados.reduce((sum, bordado) => sum + Number(bordado.monto || 0), 0)
        : Number(item?.bordado || 0);

      if (!Number.isInteger(productoId) || productoId <= 0) {
        throw new BadRequestException(`La linea ${index + 1} no tiene un producto valido`);
      }
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw new BadRequestException(`La linea ${index + 1} debe tener una cantidad entera mayor a 0`);
      }
      if (!bodegaId) {
        throw new BadRequestException(`La linea ${index + 1} no tiene bodega origen`);
      }

      return {
        ...item,
        productoId,
        cantidad,
        bodegaId,
        precio: Number(item?.precio || 0),
        bordado: totalBordado,
        bordados,
        bordadoColor: primerBordado?.color || item?.bordadoColor || null,
        bordadoTamano: primerBordado?.tamano || item?.bordadoTamano || null,
        bordadoPosicion: primerBordado?.posicion || item?.bordadoPosicion || null,
        bordadoObservaciones: primerBordado?.observaciones || item?.bordadoObservaciones || null,
        bordadoImagenUrl: primerBordado?.imagenUrl || item?.bordadoImagenUrl || null,
        descuento: Number(item?.descuento || 0),
        estiloEspecialMonto: Number(item?.estiloEspecialMonto || 0),
      };
    });
  }

  private async cargarBodegasVenta(bodegaIds: number[]) {
    const ids = Array.from(new Set(bodegaIds.filter((id) => Number.isInteger(id) && id > 0)));
    const bodegas = await this.prisma.bodega.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        nombre: true,
        activa: true,
        permiteVentas: true,
        usaInventarioVentas: true,
        requiereAutorizacion: true,
      },
    });
    const porId = new Map(bodegas.map((bodega) => [bodega.id, bodega]));
    const faltantes = ids.filter((id) => !porId.has(id));
    if (faltantes.length) {
      throw new BadRequestException(`Bodega no encontrada: ${faltantes.join(", ")}`);
    }
    const noDisponibles = bodegas.filter((bodega) => bodega.activa === false || bodega.permiteVentas === false);
    if (noDisponibles.length) {
      throw new BadRequestException(`Estas bodegas no permiten ventas: ${noDisponibles.map((b) => b.nombre).join(", ")}`);
    }
    return porId;
  }

  private async createVentaTransaccional(
    data: any,
    usuarioId?: number | null,
    user?: { id?: number; rol?: string | null; permisos?: string[] | null; bodegaId?: number | string | null },
  ) {
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

    const ventaBodegaId = Number(data?.bodegaId || 0);
    if (!ventaBodegaId) {
      throw new BadRequestException("Selecciona la bodega de la venta");
    }
    await this.assertVentaBodegaDocumento(ventaBodegaId, user);
    await assertBodegaAccess(this.prisma, user, ventaBodegaId, "ventas");

    const detalleItems = this.normalizarDetalleVenta(data);
    const bodegaIdsDetalle = Array.from(new Set<number>(detalleItems.map((item: any) => Number(item.bodegaId))));
    const bodegaInventarioPorId = await this.cargarBodegasVenta([ventaBodegaId, ...bodegaIdsDetalle]);

    for (const bodegaId of bodegaIdsDetalle) {
      await assertBodegaAccess(this.prisma, user, bodegaId, "ventas");
    }

    const productoIds = Array.from(new Set<number>(detalleItems.map((item: any) => Number(item.productoId))));
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: productoIds } },
      select: { id: true },
    });
    const productosExistentes = new Set(productos.map((producto) => producto.id));
    const productosFaltantes = productoIds.filter((id) => !productosExistentes.has(id));
    if (productosFaltantes.length) {
      throw new BadRequestException(`Producto no encontrado: ${productosFaltantes.join(", ")}`);
    }

    const consumoInventario = new Map<string, { bodegaId: number; productoId: number; cantidad: number; bodegaNombre: string }>();
    for (const item of detalleItems) {
      const bodegaInventario = bodegaInventarioPorId.get(Number(item.bodegaId));
      if (!bodegaInventario?.usaInventarioVentas) continue;
      const key = `${item.bodegaId}:${item.productoId}`;
      const current = consumoInventario.get(key);
      consumoInventario.set(key, {
        bodegaId: Number(item.bodegaId),
        productoId: Number(item.productoId),
        cantidad: (current?.cantidad || 0) + Number(item.cantidad || 0),
        bodegaNombre: bodegaInventario.nombre || "la bodega seleccionada",
      });
    }

    for (const item of consumoInventario.values()) {
      const inventarioActual = await this.prisma.inventario.findUnique({
        where: { bodegaId_productoId: { bodegaId: item.bodegaId, productoId: item.productoId } },
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
    const lowStockCandidates: Array<{ bodegaId: number; productoId: number }> = [];

    const ventaActualizada = await this.prisma.$transaction(async (tx) => {
      const venta = await tx.venta.create({
        data: {
          folio,
          clienteId,
          clienteNombre: clienteNombre || "CF",
          clienteTelefono: clienteTelefono || null,
          metodoPago,
          ubicacion: data.ubicacion || null,
          observaciones: null,
          total: 0,
          envio: Math.max(0, Number(data.envio || 0)),
          bodegaId: ventaBodegaId,
          vendedor: data.vendedor || null,
        } as any,
      });

      let subtotalTotal = 0;
      const detallesConTraslado: Array<{
        detalleVentaId: number;
        productoId: number;
        cantidad: number;
        desdeBodegaId: number;
        haciaBodegaId: number;
        requiereAutorizacion: boolean;
      }> = [];
      const movimientosInventario: Array<{ bodegaId: number; productoId: number; tipo: string; cantidad: number; referencia: string }> = [];

      for (const item of detalleItems) {
        const itemBodegaId = Number(item.bodegaId);
        const bodegaInventario = bodegaInventarioPorId.get(itemBodegaId);
        const descontarInventario = Boolean(bodegaInventario?.usaInventarioVentas);
        const requiereTraslado = itemBodegaId !== ventaBodegaId;
        const precioUnit = Number(item.precio || 0);
        const bordado = Number(item.bordado || 0);
        const tieneBordado =
          Number(bordado || 0) > 0 ||
          Boolean(item.bordadoColor) ||
          Boolean(item.bordadoTamano) ||
          Boolean(item.bordadoPosicion) ||
          Boolean(item.bordadoImagenUrl);
        const descuento = Number(item.descuento || 0);
        const estiloEspecial = Boolean(item.estiloEspecial);
        const estiloEspecialMonto = estiloEspecial ? Number(item.estiloEspecialMonto || 0) : 0;
        const precioConDescuento = (precioUnit + estiloEspecialMonto) * (1 - descuento / 100);
        const subtotal = item.cantidad * (precioConDescuento + bordado);
        subtotalTotal += subtotal;

        const detalleCreado = await tx.detalleVenta.create({
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
            bordados: item.bordados?.length
              ? {
                  create: item.bordados.map((bordado: any) => ({
                    monto: Number(bordado.monto || 0),
                    color: bordado.color || null,
                    tamano: bordado.tamano || null,
                    posicion: bordado.posicion || null,
                    observaciones: bordado.observaciones || null,
                    imagenUrl: bordado.imagenUrl || null,
                    estado: "EN PRODUCCION",
                    fechaEntrega: item.bordadoFechaEntrega ? new Date(item.bordadoFechaEntrega) : null,
                  })),
                }
              : undefined,
          } as any,
        });

        if (requiereTraslado) {
          detallesConTraslado.push({
            detalleVentaId: detalleCreado.id,
            productoId: Number(item.productoId),
            cantidad: Number(item.cantidad || 0),
            desdeBodegaId: itemBodegaId,
            haciaBodegaId: ventaBodegaId,
            requiereAutorizacion: Boolean(bodegaInventario?.requiereAutorizacion),
          });
        }

        if (descontarInventario) {
          movimientosInventario.push({
            bodegaId: itemBodegaId,
            productoId: Number(item.productoId),
            tipo: "venta_salida",
            cantidad: Number(item.cantidad || 0),
            referencia: folio || `Venta #${venta.id}`,
          });
        }
      }

      for (const item of consumoInventario.values()) {
        const result = await tx.inventario.updateMany({
          where: {
            bodegaId: item.bodegaId,
            productoId: item.productoId,
            stock: { gte: item.cantidad },
          },
          data: { stock: { decrement: item.cantidad } },
        });
        if (result.count !== 1) {
          const inventarioActual = await tx.inventario.findUnique({
            where: { bodegaId_productoId: { bodegaId: item.bodegaId, productoId: item.productoId } },
            select: { stock: true },
          });
          throw new BadRequestException(
            `Stock insuficiente en ${item.bodegaNombre}. Disponible: ${Number(inventarioActual?.stock || 0)}. Solicitado: ${item.cantidad}.`,
          );
        }

        const invUpdated = await tx.inventario.findUnique({
          where: { bodegaId_productoId: { bodegaId: item.bodegaId, productoId: item.productoId } },
          select: { stock: true },
        });
        const minimo = await tx.stockMinimoBodegaProducto.findUnique({
          where: { bodegaId_productoId: { bodegaId: item.bodegaId, productoId: item.productoId } },
          select: { minimo: true },
        });
        const threshold = Number(minimo?.minimo ?? process.env.STOCK_ALERT_THRESHOLD ?? 5);
        if (invUpdated && invUpdated.stock < threshold) {
          lowStockCandidates.push({ bodegaId: item.bodegaId, productoId: item.productoId });
        }
      }

      if (movimientosInventario.length) {
        await tx.movInventario.createMany({ data: movimientosInventario });
      }

      const gruposTraslado = new Map<string, typeof detallesConTraslado>();
      detallesConTraslado.forEach((item) => {
        const key = `${item.desdeBodegaId}:${item.haciaBodegaId}:${item.requiereAutorizacion ? "APROBACION" : "DIRECTO"}`;
        gruposTraslado.set(key, [...(gruposTraslado.get(key) || []), item]);
      });

      let solicitudIndex = 1;
      for (const grupo of gruposTraslado.values()) {
        const first = grupo[0];
        const estado = first.requiereAutorizacion ? "PENDIENTE_APROBACION" : "PENDIENTE";
        const solicitud = await tx.solicitudTraslado.create({
          data: {
            folio: `ST-${venta.id}-${solicitudIndex++}`,
            ventaId: venta.id,
            desdeBodegaId: first.desdeBodegaId,
            haciaBodegaId: first.haciaBodegaId,
            estado,
            responsable: data.vendedor || null,
            observaciones: `Solicitud generada desde ${folio || `venta #${venta.id}`}`,
            detalle: {
              create: grupo.map((item) => ({
                detalleVentaId: item.detalleVentaId,
                productoId: item.productoId,
                cantidad: item.cantidad,
              })),
            },
          },
        });
        await tx.detalleVenta.updateMany({
          where: { id: { in: grupo.map((item) => item.detalleVentaId) } },
          data: { solicitudTrasladoId: solicitud.id, trasladoEstado: estado },
        });
      }

      let recargo = 0;
      const envio = Math.max(0, Number(data.envio || 0));
      let total = subtotalTotal + envio;
      if (this.metodoUsaRecargo(metodoPago)) {
        const porcentaje = Number(data.porcentajeRecargo) || 0;
        recargo = subtotalTotal * (porcentaje / 100);
        total += recargo;
      }

      const pago = await tx.pagoVenta.create({
        data: {
          ventaId: venta.id,
          metodo: metodoPago,
          monto: total,
          referencia: this.metodoRequiereReferencia(metodoPago) ? referencia : null,
        },
      });
      if (metodoPago === "deposito_bancario" && banco) {
        await tx.$executeRaw`UPDATE PagoVenta SET banco = ${banco} WHERE id = ${pago.id}`;
      }

      return tx.venta.update({
        where: { id: venta.id },
        data: { total, recargo, envio },
        include: {
          detalle: { include: { bodegaOrigen: true } },
          pagos: true,
          cliente: true,
          bodega: true,
        },
      });
    });

    try {
      const uniqueLowStock = Array.from(
        new Map(lowStockCandidates.map((item) => [`${item.bodegaId}:${item.productoId}`, item])).values(),
      );
      if (uniqueLowStock.length) {
        await this.notifier.notifyLowStock(uniqueLowStock);
      }
      await this.notifier.notifyHighSale(Number(ventaActualizada.total || 0), folio || `V-${ventaActualizada.id}`);
    } catch (error) {
      console.error("No se pudieron enviar notificaciones de venta:", error);
    }

    return { ...ventaActualizada, folio };
  }

  async createVenta(
    data: any,
    usuarioId?: number | null,
    user?: { id?: number; rol?: string | null; permisos?: string[] | null; bodegaId?: number | string | null },
  ) {
    return this.createVentaTransaccional(data, usuarioId, user);
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

  async findAll(user?: { id?: number; rol?: string | null; permisos?: string[] | null }, query: any = {}) {
    await this.completarFoliosPendientes();

    const where = await this.buildVentaWhere(user);
    const pagination = parsePaginationQuery(query);
    const lite = parseBooleanQuery(query.lite);
    if (lite) {
      const args: any = {
        where,
        select: {
          id: true,
          folio: true,
          fecha: true,
          total: true,
          bodegaId: true,
          vendedor: true,
          clienteNombre: true,
          clienteTelefono: true,
          metodoPago: true,
          bodega: { select: { id: true, nombre: true } },
          cliente: { select: { id: true, nombre: true } },
        },
        orderBy: { id: "desc" as const },
      };
      if (pagination) {
        const [total, ventas] = await Promise.all([
          this.prisma.venta.count({ where }),
          this.prisma.venta.findMany({ ...args, skip: pagination.skip, take: pagination.take }),
        ]);
        return paginatedResponse(ventas, total, pagination.page, pagination.pageSize);
      }
      return this.prisma.venta.findMany(args);
    }

    const ventas = await this.prisma.venta.findMany({
      where,
      include: {
        detalle: { include: { bodegaOrigen: true } },
        pagos: true,
        cliente: true,
        bodega: true,
      },
      orderBy: { id: "desc" },
      ...(pagination ? { skip: pagination.skip, take: pagination.take } : {}),
    });
    const rows = ventas.map((venta) => ({
      ...venta,
    }));
    if (!pagination) return rows;
    const total = await this.prisma.venta.count({ where });
    return paginatedResponse(rows, total, pagination.page, pagination.pageSize);
  }
}
