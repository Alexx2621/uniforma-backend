import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { AlertasService } from "../alertas/alertas.service";
import { ProduccionGateway } from "./produccion.gateway";
import { TrackingService } from "../tracking/tracking.service";
import { paginatedResponse, parseBooleanQuery, parsePaginationQuery } from "../common/pagination";
import { getGuatemalaDayRange, parseGuatemalaDate } from "../common/date-range";

const PEDIDO_AUTORIZACION_MONTO_MINIMO = 3000;
const PAGO_PEDIDO_COMPAT_SELECT = {
  id: true,
  pedidoId: true,
  monto: true,
  metodo: true,
  tipo: true,
  fecha: true,
  recargo: true,
  porcentajeRecargo: true,
  referencia: true,
  banco: true,
  numeroEnvio: true,
  numeroRecibo: true,
  referenciaDocumento: true,
  observacionesPago: true,
};

@Injectable()
export class ProduccionService {
  constructor(
    private prisma: PrismaService,
    private alertasService: AlertasService,
    private produccionGateway: ProduccionGateway,
    private trackingService: TrackingService,
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
    const bordados = this.normalizeBordadosDetalle(detalle);
    const primerBordado = bordados[0] || null;
    const bordadoTotal = bordados.length
      ? bordados.reduce((sum, bordado) => sum + Number(bordado.monto || 0), 0)
      : Number(detalle?.bordado ?? 0);

    return {
      ...detalle,
      cantidad: Number(detalle?.cantidad || 0),
      precioUnit: Number(detalle?.precioUnit || 0),
      bordado: bordadoTotal,
      bordadoColor: primerBordado?.color || detalle?.bordadoColor || null,
      bordadoTamano: primerBordado?.tamano || detalle?.bordadoTamano || null,
      bordadoPosicion: primerBordado?.posicion || detalle?.bordadoPosicion || null,
      bordadoObservaciones: primerBordado?.observaciones || detalle?.bordadoObservaciones || null,
      bordadoImagenUrl: primerBordado?.imagenUrl || detalle?.bordadoImagenUrl || null,
      bordadoEstado: primerBordado?.estado || detalle?.bordadoEstado || "EN PRODUCCION",
      bordadoFechaEntrega: primerBordado?.fechaEntrega || detalle?.bordadoFechaEntrega || null,
      bordados,
      estiloEspecial: Boolean(detalle?.estiloEspecial),
      estiloEspecialMonto: Number(detalle?.estiloEspecialMonto ?? 0),
      descuento: Number(detalle?.descuento ?? 0),
    };
  }

  private roundMoney(value: unknown) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round((parsed + Number.EPSILON) * 100) / 100;
  }

  private hasPendingBalance(value: unknown) {
    return this.roundMoney(value) > 0;
  }

  private getPagoAplicado(pago: any) {
    return this.roundMoney(Number(pago?.monto || 0) + Number(pago?.recargo || 0));
  }

  private resolverSaldoPendientePedido(pedido: any) {
    const estado = `${pedido?.estado || ""}`.trim().toLowerCase();
    if (["anulado", "recibido", "completado"].includes(estado)) return 0;

    const saldoGuardado = this.roundMoney(pedido?.saldoPendiente);
    if (saldoGuardado > 0) return saldoGuardado;

    const total = Number(pedido?.totalEstimado || 0);
    const anticipo = Number(pedido?.anticipo || 0);
    const pagado = Array.isArray(pedido?.pagos)
      ? pedido.pagos.reduce((sum: number, pago: any) => sum + this.getPagoAplicado(pago), 0)
      : 0;

    return this.roundMoney(Math.max(0, total - Math.max(anticipo, pagado)));
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
      unificado: Boolean(pedido?.unificadoCorrelativo) || (Array.isArray(pedido?.unificaciones) && pedido.unificaciones.length > 0),
      unificadoCorrelativo:
        pedido?.unificadoCorrelativo ||
        (Array.isArray(pedido?.unificaciones)
          ? pedido.unificaciones.find((item: any) => item?.produccionUnificado?.correlativo)?.produccionUnificado?.correlativo || null
          : null),
      detalle: Array.isArray(pedido?.detalle) ? pedido.detalle.map((item: any) => this.normalizeDetallePedido(item)) : [],
      pagos: Array.isArray(pedido?.pagos)
        ? pedido.pagos.map((pago: any) => ({
            ...pago,
            monto: Number(pago?.monto || 0),
            recargo: Number(pago?.recargo || 0),
            porcentajeRecargo: Number(pago?.porcentajeRecargo || 0),
          }))
        : [],
      esOrdenMixta: Array.isArray(pedido?.ordenesMixtas) && pedido.ordenesMixtas.length > 0,
      ordenMixta: Array.isArray(pedido?.ordenesMixtas) && pedido.ordenesMixtas.length > 0 ? pedido.ordenesMixtas[0] : null,
    };
  }

  private async hydratePagoPedidoMetadata(pedidos: any[]) {
    const pagoIds = Array.from(
      new Set(
        pedidos.flatMap((pedido) =>
          Array.isArray(pedido?.pagos)
            ? pedido.pagos.map((pago: any) => Number(pago?.id || 0)).filter((id: number) => Number.isInteger(id) && id > 0)
            : [],
        ),
      ),
    );
    if (!pagoIds.length) return pedidos;

    try {
      const rows = await this.prisma.$queryRaw<Array<{ id: number; banco: string | null; ubicacion: string | null }>>(
        Prisma.sql`SELECT id, banco, ubicacion FROM PagoPedido WHERE id IN (${Prisma.join(pagoIds)})`,
      );
      const byId = new Map(rows.map((row) => [Number(row.id), row]));
      return pedidos.map((pedido) => ({
        ...pedido,
        pagos: Array.isArray(pedido?.pagos)
          ? pedido.pagos.map((pago: any) => {
              const metadata = byId.get(Number(pago?.id || 0));
              return metadata
                ? {
                    ...pago,
                    banco: metadata.banco ?? pago.banco ?? null,
                    ubicacion: metadata.ubicacion ?? pago.ubicacion ?? null,
                  }
                : pago;
            })
          : pedido?.pagos,
      }));
    } catch {
      return pedidos;
    }
  }

  private async safeSetPagoPedidoUbicacion(tx: any, pagoId: number, ubicacion: string) {
    try {
      await tx.$executeRaw`UPDATE PagoPedido SET ubicacion = ${ubicacion} WHERE id = ${pagoId}`;
    } catch (error) {
      console.warn("No se pudo guardar ubicacion de PagoPedido; verifica migracion PagoPedido.ubicacion", error);
    }
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

  private hasPermission(user: { permisos?: string[] | null } | undefined, permission: string) {
    return Array.isArray(user?.permisos) && user.permisos.includes(permission);
  }

  private canAutorizarPedidos(user?: { rol?: string | null; permisos?: string[] | null }) {
    return this.isAdmin(user) || this.hasPermission(user, "produccion.autorizar-pedidos");
  }

  private canCrearPedidoSinAutorizacion(user?: { rol?: string | null; permisos?: string[] | null }) {
    return this.canAutorizarPedidos(user) || this.hasPermission(user, "produccion.crear-sin-autorizacion");
  }

  private rethrowPedidoValidationError(error: unknown, fallback: string): never {
    if (error instanceof HttpException) throw error;
    const message = error instanceof Error ? error.message : "";
    throw new BadRequestException(message || fallback);
  }

  private async assertDetallePedidoValido(tx: any, detalles: any[]) {
    if (!Array.isArray(detalles) || !detalles.length) {
      throw new BadRequestException("Agrega al menos un producto al pedido");
    }

    const productoIds = detalles.map((item) => Number(item?.productoId || 0));
    const invalidProductLine = productoIds.findIndex((id) => !Number.isInteger(id) || id <= 0);
    if (invalidProductLine >= 0) {
      throw new BadRequestException(`La linea ${invalidProductLine + 1} no tiene un producto valido`);
    }

    const invalidQuantityLine = detalles.findIndex((item) => !Number.isInteger(Number(item?.cantidad || 0)) || Number(item?.cantidad || 0) <= 0);
    if (invalidQuantityLine >= 0) {
      throw new BadRequestException(`La linea ${invalidQuantityLine + 1} tiene una cantidad invalida`);
    }

    const uniqueProductoIds = Array.from(new Set(productoIds));
    const productos = await tx.producto.findMany({
      where: { id: { in: uniqueProductoIds } },
      select: { id: true, codigo: true },
    });
    const existentes = new Set(productos.map((producto: any) => Number(producto.id)));
    const faltantes = uniqueProductoIds.filter((id) => !existentes.has(id));
    if (faltantes.length) {
      throw new BadRequestException(`Hay productos que ya no existen o no estan disponibles: ${faltantes.join(", ")}`);
    }
  }

  private getPedidoTotalAutorizacion(data: any) {
    const totalEstimado = Number(data?.totalEstimado || 0);
    if (Number.isFinite(totalEstimado) && totalEstimado > 0) return totalEstimado;
    const detalles = Array.isArray(data?.detalle) ? data.detalle : [];
    const subtotal = detalles.reduce((sum, item) => {
      const precio = Number(item?.precioUnit || 0);
      const cantidad = Number(item?.cantidad || 0);
      const bordado = Number(item?.bordado || 0);
      const estiloEspecial = item?.estiloEspecial ? Number(item?.estiloEspecialMonto || 0) : 0;
      const descuento = Number(item?.descuento || 0);
      const precioConDescuento = (precio + estiloEspecial) * (1 - descuento / 100);
      return sum + cantidad * (precioConDescuento + bordado);
    }, 0);
    const metodo = this.normalizarMetodoPago(data?.metodoPago);
    const recargo = this.metodoUsaRecargo(metodo) ? subtotal * (Number(data?.porcentajeRecargo || 0) / 100) : 0;
    const envio = Math.max(0, Number(data?.envio || 0));
    return subtotal + recargo + envio;
  }

  private requiereAutorizacionPedido(data: any) {
    const metodo = this.normalizarMetodoPago(data?.metodoPago);
    return metodo === "sin_cobro_stock" || this.getPedidoTotalAutorizacion(data) > PEDIDO_AUTORIZACION_MONTO_MINIMO;
  }

  private getTipoSolicitudPedido(solicitud: any) {
    return `${solicitud?.tipoSolicitud || solicitud?.payload?.tipoSolicitud || solicitud?.payload?.__tipoSolicitud || "creacion"}`
      .trim()
      .toLowerCase();
  }

  private async reemplazarAutorizacionesPendientesPedido(params: {
    pedidoId: number;
    tipoSolicitud: string;
    nuevaSolicitudSolicitadaPorId: number;
  }) {
    const pedidoId = Number(params.pedidoId || 0);
    if (!pedidoId) return [];

    const pendientes = await this.prisma.pedidoProduccionAutorizacion.findMany({
      where: {
        pedidoId,
        estado: "pendiente",
      },
      select: {
        id: true,
        solicitadoPorId: true,
        payload: true,
      },
    });

    const reemplazadas = pendientes.filter(
      (solicitud) => this.getTipoSolicitudPedido(solicitud) === params.tipoSolicitud,
    );
    const ids = reemplazadas.map((solicitud) => solicitud.id);
    if (!ids.length) return [];

    await this.prisma.pedidoProduccionAutorizacion.updateMany({
      where: { id: { in: ids } },
      data: {
        estado: "reemplazada",
        respuestaComentario: "Solicitud reemplazada por una nueva solicitud para el mismo documento.",
        autorizadoEn: new Date(),
      },
    });

    await this.alertasService.marcarAlertasAutorizacionPedidoLeidas(ids);

    reemplazadas.forEach((solicitud) => {
      this.alertasService.emitirAutorizacionPedidoResuelta({
        solicitudId: solicitud.id,
        estado: "reemplazada",
        comentario: "Se envio una nueva solicitud para este pedido. Esta solicitud anterior fue reemplazada.",
        solicitanteId: solicitud.solicitadoPorId,
        reemplazadaPorSolicitanteId: params.nuevaSolicitudSolicitadaPorId,
      });
    });

    return ids;
  }

  private async getUsuariosAutorizadoresPedidos() {
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

  private async buildDetalleSolicitudPedido(data: any) {
    const detallesSolicitud = Array.isArray(data?.detalle) ? data.detalle : [];
    const productos = detallesSolicitud.length
      ? await this.prisma.producto.findMany({
          where: {
            id: {
              in: Array.from(
                new Set(detallesSolicitud.map((item: any) => Number(item?.productoId || 0)).filter((id: number) => id > 0)),
              ),
            },
          },
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
    return detallesSolicitud.map((item: any, index: number) => {
      const producto = productosMap.get(Number(item?.productoId || 0));
      const cantidad = Number(item?.cantidad || 0);
      const precioUnit = Number(item?.precioUnit || 0);
      const bordado = Number(item?.bordado || 0);
      const estiloEspecialMonto = item?.estiloEspecial ? Number(item?.estiloEspecialMonto || 0) : 0;
      const descuento = Number(item?.descuento || 0);
      const precioConDescuento = (precioUnit + estiloEspecialMonto) * (1 - descuento / 100);
      return {
        linea: index + 1,
        productoId: Number(item?.productoId || 0),
        codigo: producto?.codigo || `${item?.productoId || "N/D"}`,
        nombre: producto?.nombre || "Producto",
        tipo: producto?.tipo || null,
        genero: producto?.genero || null,
        tela: producto?.tela?.nombre || null,
        talla: producto?.talla?.nombre || null,
        color: producto?.color?.nombre || null,
        cantidad,
        precioUnit,
        bordado,
        estiloEspecialMonto,
        descuento,
        subtotal: cantidad * (precioConDescuento + bordado),
        observaciones: item?.descripcion || null,
      };
    });
  }

  private canFilterBordadosByUsuario(user?: { rol?: string | null; permisos?: string[] | null }) {
    return ["ADMIN", "BORDADOR"].includes(`${user?.rol || ""}`.trim().toUpperCase()) || this.hasPermission(user, "sistema.multi-tienda");
  }

  private canManageBordados(user?: { rol?: string | null; permisos?: string[] | null }) {
    return ["ADMIN", "BORDADOR"].includes(`${user?.rol || ""}`.trim().toUpperCase()) || this.hasPermission(user, "bordados.manage");
  }

  private normalizeBordadoEstado(value?: string | null) {
    const estado = `${value || "EN PRODUCCION"}`.trim().toUpperCase();
    const estadosValidos = new Set(["EN PRODUCCION", "EN COLA", "BORDANDO", "ENVIADO"]);
    return estadosValidos.has(estado) ? estado : "EN PRODUCCION";
  }

  private parseBordadoFechaEntrega(value?: string | null) {
    const raw = `${value || ""}`.trim();
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new Error("La fecha estimada de entrega no es valida");
    }
    return date;
  }

  private normalizeBordadosDetalle(detalle: any) {
    const bordadosRaw = Array.isArray(detalle?.bordados) ? detalle.bordados : [];
    if (bordadosRaw.length) {
      return bordadosRaw.map((bordado: any, index: number) => ({
        id: bordado?.id ?? null,
        detalleId: bordado?.detalleId ?? detalle?.id ?? null,
        monto: Number(bordado?.monto ?? bordado?.bordado ?? 0),
        color: bordado?.color || bordado?.bordadoColor || null,
        tamano: bordado?.tamano || bordado?.bordadoTamano || null,
        posicion: bordado?.posicion || bordado?.bordadoPosicion || null,
        observaciones: bordado?.observaciones || bordado?.bordadoObservaciones || null,
        imagenUrl: bordado?.imagenUrl || bordado?.bordadoImagenUrl || null,
        estado: bordado?.estado || bordado?.bordadoEstado || "EN PRODUCCION",
        fechaEntrega: bordado?.fechaEntrega || bordado?.bordadoFechaEntrega || null,
        orden: index + 1,
      }));
    }

    const tieneBordadoLegacy =
      Number(detalle?.bordado || 0) > 0 ||
      Boolean(detalle?.bordadoColor) ||
      Boolean(detalle?.bordadoTamano) ||
      Boolean(detalle?.bordadoPosicion) ||
      Boolean(detalle?.bordadoObservaciones) ||
      Boolean(detalle?.bordadoImagenUrl);

    if (!tieneBordadoLegacy) return [];

    return [
      {
        id: null,
        detalleId: detalle?.id ?? null,
        monto: Number(detalle?.bordado || 0),
        color: detalle?.bordadoColor || null,
        tamano: detalle?.bordadoTamano || null,
        posicion: detalle?.bordadoPosicion || null,
        observaciones: detalle?.bordadoObservaciones || null,
        imagenUrl: detalle?.bordadoImagenUrl || null,
        estado: detalle?.bordadoEstado || "EN PRODUCCION",
        fechaEntrega: detalle?.bordadoFechaEntrega || null,
        orden: 1,
      },
    ];
  }

  private normalizeBordadosPayload(item: any, pedidoParaStock = false) {
    if (pedidoParaStock) return [];

    const raw = Array.isArray(item?.bordados) ? item.bordados : [];
    const candidates = raw.length
      ? raw
      : Number(item?.bordado || 0) > 0 ||
          Boolean(item?.bordadoColor) ||
          Boolean(item?.bordadoTamano) ||
          Boolean(item?.bordadoPosicion) ||
          Boolean(item?.bordadoImagenUrl)
        ? [
            {
              monto: item?.bordado,
              color: item?.bordadoColor,
              tamano: item?.bordadoTamano,
              posicion: item?.bordadoPosicion,
              observaciones: item?.bordadoObservaciones,
              imagenUrl: item?.bordadoImagenUrl,
              estado: item?.bordadoEstado,
              fechaEntrega: item?.bordadoFechaEntrega,
            },
          ]
        : [];

    return candidates
      .map((bordado: any) => ({
        monto: Number(bordado?.monto ?? bordado?.bordado ?? 0),
        color: `${bordado?.color ?? bordado?.bordadoColor ?? ""}`.trim(),
        tamano: `${bordado?.tamano ?? bordado?.bordadoTamano ?? ""}`.trim(),
        posicion: `${bordado?.posicion ?? bordado?.bordadoPosicion ?? ""}`.trim(),
        observaciones: `${bordado?.observaciones ?? bordado?.bordadoObservaciones ?? ""}`.trim(),
        imagenUrl: bordado?.imagenUrl || bordado?.bordadoImagenUrl || null,
        estado: this.normalizeBordadoEstado(bordado?.estado || bordado?.bordadoEstado),
        fechaEntrega: this.parseBordadoFechaEntrega(bordado?.fechaEntrega || bordado?.bordadoFechaEntrega),
      }))
      .filter(
        (bordado) =>
          bordado.monto > 0 ||
          Boolean(bordado.color) ||
          Boolean(bordado.tamano) ||
          Boolean(bordado.posicion) ||
          Boolean(bordado.observaciones) ||
          Boolean(bordado.imagenUrl),
      );
  }

  private buildBordadoObservacionPrefix(bordados: Array<{ posicion?: string | null }>) {
    const posiciones = Array.from(
      new Set(
        (bordados || [])
          .map((bordado) => `${bordado?.posicion || ""}`.trim().toUpperCase())
          .filter(Boolean),
      ),
    );
    return posiciones.length ? `BORDADO ${posiciones.join(" / ")}.` : "";
  }

  private formatDetalleObservaciones(descripcion: unknown, bordados: Array<{ posicion?: string | null }>) {
    const texto = `${descripcion || ""}`.trim();
    const prefix = this.buildBordadoObservacionPrefix(bordados);
    if (!prefix) return texto;
    const sinPrefixAnterior = texto.replace(/^BORDADO\b.*?\.\s*/i, "").trim();
    return [prefix, sinPrefixAnterior].filter(Boolean).join(" ");
  }

  private normalizeDetalleVentaBordado(detalle: any) {
    return {
      id: detalle.id,
      productoId: detalle.productoId || 0,
      cantidad: Number(detalle.cantidad || 0),
      descripcion: detalle.descripcion || "",
      bordado: Number(detalle.bordado || 0),
      bordadoColor: detalle.bordadoColor || null,
      bordadoTamano: detalle.bordadoTamano || null,
      bordadoPosicion: detalle.bordadoPosicion || null,
      bordadoObservaciones: detalle.bordadoObservaciones || null,
      bordadoImagenUrl: detalle.bordadoImagenUrl || null,
      bordadoEstado: detalle.bordadoEstado || "EN PRODUCCION",
      bordadoFechaEntrega: detalle.bordadoFechaEntrega || null,
      producto: detalle.producto || null,
    };
  }

  private normalizeVentaBordadoResponse(row: any) {
    return {
      id: Number(row.id),
      ventaId: Number(row.id),
      origen: "venta",
      folio: row.folio || `V-${row.id}`,
      fecha: row.fecha,
      estado: "venta",
      clienteNombre: row.clienteNombre || row.cliente?.nombre || "CF",
      clienteTelefono: row.clienteTelefono || null,
      bodega: row.bodega || null,
      usuario: null,
      solicitadoPor: row.vendedor || null,
      observaciones: row.observaciones || null,
      detalle: Array.isArray(row.detalle) ? row.detalle.map((item: any) => this.normalizeDetalleVentaBordado(item)) : [],
    };
  }

  private getTodayDateRange() {
    return getGuatemalaDayRange();
  }

  private async buildPedidoUsuarioWhere(user?: { id?: number; rol?: string | null; rolId?: number | null; permisos?: string[] | null }) {
    const systemConfig = await this.getSystemConfig();
    const canAccessAll =
      this.isAdmin(user) ||
      this.hasPermission(user, "sistema.multi-tienda") ||
      this.hasPermission(user, "dashboard.filtro-tienda") ||
      this.hasPermission(user, "dashboard.ver-todo") ||
      systemConfig.crossStoreRoleIds.includes(Number(user?.rolId || 0));
    if (canAccessAll) return {};

    return this.buildPedidoUsuarioOwnerWhere(Number(user?.id || 0));
  }

  private async buildPedidoUsuarioOwnerWhere(usuarioId: number) {
    usuarioId = Number(usuarioId || 0);
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
                OR: [
                  ...nombres.map((nombre) => ({ solicitadoPor: { contains: nombre } })),
                  ...(usuario?.usuarioCorrelativo
                    ? [{ folio: { startsWith: `PE-${this.sanitizeCorrelativoCode(usuario.usuarioCorrelativo)}-` } }]
                    : []),
                ],
              },
            ]
          : []),
      ],
    };
  }

  private async buildVentaUsuarioOwnerWhere(usuarioId: number) {
    usuarioId = Number(usuarioId || 0);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      return { id: -1 };
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { nombre: true, usuario: true, usuarioCorrelativo: true, bodegaId: true },
    });
    if (!usuario) return { id: -1 };

    const nombreParts = `${usuario.nombre || ""}`.trim().split(/\s+/).filter(Boolean);
    const nombres = Array.from(
      new Set(
        [
          usuario.usuario,
          usuario.usuario?.replace(/[._-]+/g, " "),
          usuario.nombre,
          usuario.usuarioCorrelativo,
          nombreParts.length >= 2 ? `${nombreParts[0]} ${nombreParts[1]}` : null,
        ]
          .map((value) => `${value || ""}`.trim())
          .filter(Boolean),
      ),
    );
    const filtros = [
      ...(usuario.bodegaId ? [{ bodegaId: usuario.bodegaId }] : []),
      ...nombres.map((nombre) => ({ vendedor: { contains: nombre } })),
    ];

    return filtros.length ? { OR: filtros } : { id: -1 };
  }

  private async buildVentaUsuarioWhere(user?: { id?: number; rol?: string | null; rolId?: number | null; permisos?: string[] | null }) {
    const systemConfig = await this.getSystemConfig();
    const canAccessAll =
      this.isAdmin(user) ||
      this.hasPermission(user, "sistema.multi-tienda") ||
      this.hasPermission(user, "dashboard.filtro-tienda") ||
      this.hasPermission(user, "dashboard.ver-todo") ||
      systemConfig.crossStoreRoleIds.includes(Number(user?.rolId || 0));
    if (canAccessAll) return {};

    return this.buildVentaUsuarioOwnerWhere(Number(user?.id || 0));
  }

  private async assertPedidoAccess(pedidoId: number, user?: { id?: number; rol?: string | null; rolId?: number | null }) {
    const where = await this.buildPedidoUsuarioWhere(user);
    const count = await this.prisma.pedidoProduccion.count({
      where: {
        AND: [{ id: Number(pedidoId) }, where],
      } as any,
    });

    if (count <= 0) {
      throw new Error("No tienes acceso a este pedido");
    }
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

  private async assertClienteCartera(clienteId?: number | null, user?: { id?: number; rol?: string | null }, autorizacionId?: number | null) {
    if (!clienteId || `${user?.rol || ""}`.toUpperCase() === "ADMIN") return null;
    const cliente = await this.prisma.cliente.findUnique({
      where: { id: Number(clienteId) },
      select: { usuarioId: true },
    });
    if (cliente && Number(cliente.usuarioId || 0) === Number(user?.id || 0)) return null;
    const auth = await this.prisma.autorizacionVentaCliente.findFirst({ where: { id: Number(autorizacionId || 0), clienteId: Number(clienteId), solicitanteId: Number(user?.id || 0), modulo: 'pedido', estado: 'aprobado', operacionId: null } });
    if (!auth) throw new Error("Necesitas autorizacion del vendedor propietario para este pedido");
    return auth;
  }

  async crearPedido(
    data: any,
    usuarioId?: number,
    user?: { id?: number; rol?: string | null; permisos?: string[] | null },
  ) {
    if (this.requiereAutorizacionPedido(data) && !this.canCrearPedidoSinAutorizacion(user)) {
      throw new BadRequestException("Este pedido necesita autorizacion antes de generarse");
    }
    return this.crearPedidoDirecto(data, usuarioId, user);
  }

  async solicitarAutorizacionPedido(
    data: any,
    usuarioId?: number,
    user?: { id?: number; usuario?: string | null; rol?: string | null; permisos?: string[] | null },
    comentario?: string,
  ) {
    if (!usuarioId) throw new BadRequestException("No se pudo identificar el usuario solicitante");
    if (!data?.detalle?.length) throw new BadRequestException("Agrega al menos un producto al pedido");
    if (!this.requiereAutorizacionPedido(data)) {
      throw new BadRequestException("Este pedido no requiere autorizacion");
    }

    const autorizadorIds = await this.getUsuariosAutorizadoresPedidos();
    if (!autorizadorIds.length) {
      throw new BadRequestException("No hay usuarios configurados para autorizar pedidos");
    }

    const solicitud = await this.prisma.pedidoProduccionAutorizacion.create({
      data: {
        solicitadoPorId: usuarioId,
        comentario: `${comentario || ""}`.trim() || null,
        payload: { ...data, __tipoSolicitud: "creacion" },
      },
      include: {
        solicitadoPor: { select: { id: true, nombre: true, usuario: true } },
      },
    });

    const detalleItems = await this.buildDetalleSolicitudPedido(data);

    const cliente = data?.clienteNombre || "Mostrador";
    const total = Number(data?.totalEstimado || 0);
    const detalleResumen = detalleItems.length
      ? `${detalleItems.length} linea(s), ${detalleItems.reduce((sum: number, item: any) => sum + Number(item?.cantidad || 0), 0)} prenda(s)`
      : "Sin detalle";
    const solicitante = solicitud.solicitadoPor?.nombre || solicitud.solicitadoPor?.usuario || user?.usuario || "Usuario";

    await this.alertasService.crearAlertasPorUsuarios({
      usuarioIds: autorizadorIds,
      tipo: "pedido_produccion_autorizacion",
      titulo: "Pedido pendiente de autorizacion",
      mensaje: `${solicitante} solicita autorizacion para generar un pedido. Cliente: ${cliente}. Total estimado: Q ${total.toFixed(2)}. ${detalleResumen}.`,
      payload: {
        autorizacionPedidoId: solicitud.id,
        prioridad: "alta",
        solicitanteId: usuarioId,
        solicitante,
        cliente,
        total,
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

  async aprobarAutorizacionPedido(
    solicitudId: number,
    authUser?: { id?: number; rol?: string | null; permisos?: string[] | null; usuario?: string | null },
    comentario?: string,
  ) {
    if (!this.canAutorizarPedidos(authUser)) {
      throw new ForbiddenException("No tienes permisos para autorizar pedidos");
    }

    const solicitud = await this.prisma.pedidoProduccionAutorizacion.findUnique({
      where: { id: Number(solicitudId) },
      include: {
        solicitadoPor: { select: { id: true, rol: { select: { nombre: true } } } },
      },
    });
    if (!solicitud) throw new NotFoundException("Solicitud de autorizacion no encontrada");
    if (solicitud.estado !== "pendiente") {
      throw new BadRequestException("Esta solicitud ya fue resuelta");
    }

    const requesterUser = {
      id: solicitud.solicitadoPorId,
      rol: solicitud.solicitadoPor?.rol?.nombre || null,
      permisos: ["produccion.crear-sin-autorizacion"],
    };
    const tipoSolicitud = this.getTipoSolicitudPedido(solicitud);
    let pedido: any;
    try {
      pedido =
        tipoSolicitud === "edicion"
          ? await this.actualizarPedidoDirecto(Number(solicitud.pedidoId || 0), solicitud.payload, requesterUser)
          : await this.crearPedidoDirecto(solicitud.payload, solicitud.solicitadoPorId, requesterUser);
    } catch (error) {
      this.rethrowPedidoValidationError(error, "No se pudo aprobar la solicitud de pedido");
    }

    await this.prisma.pedidoProduccionAutorizacion.update({
      where: { id: solicitud.id },
      data: {
        estado: "aprobado",
        respuestaComentario: `${comentario || ""}`.trim() || null,
        autorizadoPorId: Number(authUser?.id || 0) || null,
        pedidoId: Number((pedido as any)?.id || 0) || null,
        autorizadoEn: new Date(),
      },
    });

    await this.alertasService.crearAlertasPorUsuarios({
      usuarioIds: [solicitud.solicitadoPorId],
      tipo: "pedido_produccion_autorizacion_resuelta",
      titulo: tipoSolicitud === "edicion" ? "Cambio de pedido autorizado" : "Pedido autorizado",
      mensaje:
        tipoSolicitud === "edicion"
          ? `Tu solicitud fue autorizada y se modifico el pedido ${(pedido as any)?.folio || `P-${(pedido as any)?.id}`}.`
          : `Tu solicitud fue autorizada y se genero el pedido ${(pedido as any)?.folio || `P-${(pedido as any)?.id}`}.`,
      payload: {
        autorizacionPedidoId: solicitud.id,
        pedidoId: (pedido as any)?.id,
        estado: "aprobado",
        tipoSolicitud,
        prioridad: "normal",
      },
    });

    this.alertasService.emitirAutorizacionPedidoResuelta({
      solicitudId: solicitud.id,
      estado: "aprobado",
      pedido,
      solicitanteId: solicitud.solicitadoPorId,
    });

    return { solicitudId: solicitud.id, estado: "aprobado", pedido };
  }

  async rechazarAutorizacionPedido(
    solicitudId: number,
    authUser?: { id?: number; rol?: string | null; permisos?: string[] | null },
    comentario?: string,
  ) {
    if (!this.canAutorizarPedidos(authUser)) {
      throw new ForbiddenException("No tienes permisos para autorizar pedidos");
    }

    const solicitud = await this.prisma.pedidoProduccionAutorizacion.findUnique({
      where: { id: Number(solicitudId) },
    });
    if (!solicitud) throw new NotFoundException("Solicitud de autorizacion no encontrada");
    if (solicitud.estado !== "pendiente") {
      throw new BadRequestException("Esta solicitud ya fue resuelta");
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
    const tipoSolicitud = this.getTipoSolicitudPedido(solicitud);

    await this.alertasService.crearAlertasPorUsuarios({
      usuarioIds: [solicitud.solicitadoPorId],
      tipo: "pedido_produccion_autorizacion_resuelta",
      titulo: tipoSolicitud === "edicion" ? "Cambio de pedido no autorizado" : "Pedido no autorizado",
      mensaje:
        tipoSolicitud === "edicion"
          ? `Tu solicitud para modificar el pedido fue rechazada.${updated.respuestaComentario ? ` Motivo: ${updated.respuestaComentario}` : ""}`
          : `Tu solicitud de pedido fue rechazada.${updated.respuestaComentario ? ` Motivo: ${updated.respuestaComentario}` : ""}`,
      payload: {
        autorizacionPedidoId: solicitud.id,
        estado: "rechazado",
        tipoSolicitud,
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

  private async assertCanModificarPedido(
    pedidoId: number,
    user?: { id?: number; rol?: string | null; permisos?: string[] | null },
  ) {
    if (!user?.id) throw new ForbiddenException("No se pudo identificar el usuario");
    const pedido = await this.prisma.pedidoProduccion.findUnique({
      where: { id: Number(pedidoId) },
      select: {
        usuarioId: true,
        unificadoCorrelativo: true,
        unificaciones: { select: { produccionUnificadoId: true }, take: 1 },
      },
    });
    if (!pedido) throw new NotFoundException("Pedido no encontrado");
    if (pedido.unificadoCorrelativo || pedido.unificaciones.length) {
      throw new BadRequestException("No se puede modificar un pedido que ya fue incluido en unificado");
    }
    if (this.isAdmin(user)) return;
    if (Number(pedido.usuarioId || 0) !== Number(user.id || 0)) {
      throw new ForbiddenException("Solo el usuario que registro el pedido o un administrador puede modificarlo");
    }
  }

  async actualizarPedido(
    pedidoId: number,
    data: any,
    user?: { id?: number; usuario?: string | null; rol?: string | null; permisos?: string[] | null },
  ) {
    await this.assertCanModificarPedido(pedidoId, user);
    if (this.isAdmin(user)) {
      return this.actualizarPedidoDirecto(pedidoId, data, user);
    }
    return this.solicitarAutorizacionEdicionPedido(pedidoId, data, user, data?.comentarioAutorizacion);
  }

  private async solicitarAutorizacionEdicionPedido(
    pedidoId: number,
    data: any,
    user?: { id?: number; usuario?: string | null; rol?: string | null; permisos?: string[] | null },
    comentario?: string,
  ) {
    if (!user?.id) throw new BadRequestException("No se pudo identificar el usuario solicitante");
    if (!data?.detalle?.length) throw new BadRequestException("Agrega al menos un producto al pedido");
    const pedido = await this.prisma.pedidoProduccion.findUnique({
      where: { id: Number(pedidoId) },
      select: {
        id: true,
        folio: true,
        estado: true,
        usuarioId: true,
        clienteNombre: true,
        unificadoCorrelativo: true,
        unificaciones: { select: { produccionUnificadoId: true }, take: 1 },
      },
    });
    if (!pedido) throw new NotFoundException("Pedido no encontrado");
    if (["anulado", "recibido", "completado"].includes(`${pedido.estado || ""}`.trim().toLowerCase())) {
      throw new BadRequestException("No se puede modificar un pedido anulado, recibido o completado");
    }
    if (pedido.unificadoCorrelativo || pedido.unificaciones.length) {
      throw new BadRequestException("No se puede modificar un pedido que ya fue incluido en unificado");
    }
    if (Number(pedido.usuarioId || 0) !== Number(user.id || 0)) {
      throw new ForbiddenException("Solo el usuario que registro el pedido puede solicitar cambios");
    }

    const autorizadorIds = await this.getUsuariosAutorizadoresPedidos();
    if (!autorizadorIds.length) {
      throw new BadRequestException("No hay usuarios configurados para autorizar pedidos");
    }

    await this.reemplazarAutorizacionesPendientesPedido({
      pedidoId: pedido.id,
      tipoSolicitud: "edicion",
      nuevaSolicitudSolicitadaPorId: Number(user.id),
    });

    const solicitud = await this.prisma.pedidoProduccionAutorizacion.create({
      data: {
        solicitadoPorId: Number(user.id),
        pedidoId: pedido.id,
        comentario: `${comentario || ""}`.trim() || null,
        payload: { ...data, __tipoSolicitud: "edicion" },
      },
      include: {
        solicitadoPor: { select: { id: true, nombre: true, usuario: true } },
      },
    });

    const detalleItems = await this.buildDetalleSolicitudPedido(data);
    const total = Number(data?.totalEstimado || 0);
    const detalleResumen = detalleItems.length
      ? `${detalleItems.length} linea(s), ${detalleItems.reduce((sum: number, item: any) => sum + Number(item?.cantidad || 0), 0)} prenda(s)`
      : "Sin detalle";
    const solicitante = solicitud.solicitadoPor?.nombre || solicitud.solicitadoPor?.usuario || user?.usuario || "Usuario";
    const cliente = data?.clienteNombre || pedido.clienteNombre || "Mostrador";

    await this.alertasService.crearAlertasPorUsuarios({
      usuarioIds: autorizadorIds,
      tipo: "pedido_produccion_edicion_autorizacion",
      titulo: "Cambio de pedido pendiente",
      mensaje: `${solicitante} solicita modificar el pedido ${pedido.folio || `P-${pedido.id}`}. Cliente: ${cliente}. Total estimado: Q ${total.toFixed(2)}. ${detalleResumen}.`,
      payload: {
        autorizacionPedidoId: solicitud.id,
        pedidoId: pedido.id,
        folio: pedido.folio,
        prioridad: "alta",
        solicitanteId: Number(user.id),
        solicitante,
        cliente,
        total,
        detalleResumen,
        detalleItems,
        comentario: `${comentario || ""}`.trim() || null,
      },
    });

    return {
      id: solicitud.id,
      estado: solicitud.estado,
      tipoSolicitud: "edicion",
      autorizadores: autorizadorIds.length,
    };
  }

  private async actualizarPedidoDirecto(
    pedidoId: number,
    data: any,
    user?: { id?: number; usuario?: string | null; rol?: string | null },
  ) {
    const pedidoExistente = await this.prisma.pedidoProduccion.findUnique({
      where: { id: Number(pedidoId) },
      include: {
        pagos: true,
        detalle: { select: { id: true } },
        unificaciones: { select: { produccionUnificadoId: true }, take: 1 },
        usuario: { select: { nombre: true, usuario: true } },
      },
    });
    if (!pedidoExistente) throw new NotFoundException("Pedido no encontrado");
    if (["anulado", "recibido", "completado"].includes(`${pedidoExistente.estado || ""}`.trim().toLowerCase())) {
      throw new BadRequestException("No se puede modificar un pedido anulado, recibido o completado");
    }
    if (pedidoExistente.unificadoCorrelativo || pedidoExistente.unificaciones.length) {
      throw new BadRequestException("No se puede modificar un pedido que ya fue incluido en unificado");
    }

    const pedidoParaStockGlobal = this.normalizarMetodoPago(data?.metodoPago) === "sin_cobro_stock";
    if (!pedidoParaStockGlobal) {
      await this.assertClienteCartera(Number(data?.clienteId || 0) || null, user, Number(data?.autorizacionClienteId || 0));
    }

    const pedido = await this.prisma.$transaction(async (tx) => {
      const detalles = Array.isArray(data.detalle) ? data.detalle : [];
      await this.assertDetallePedidoValido(tx, detalles);
      const metodoPago = this.normalizarMetodoPago(data.metodoPago);
      const pedidoParaStock = metodoPago === "sin_cobro_stock";
      const referencia = `${data?.referenciaPago || data?.referencia || ""}`.trim();
      const banco = `${data?.bancoPago || data?.banco || ""}`.trim();
      const solicitadoPor =
        `${pedidoExistente.solicitadoPor || pedidoExistente.usuario?.nombre || pedidoExistente.usuario?.usuario || ""}`.trim() ||
        null;
      const clienteNombre = pedidoParaStock ? "Pedido para stock" : `${data?.clienteNombre || ""}`.trim();
      const clienteTelefono = pedidoParaStock ? "" : `${data?.clienteTelefono || ""}`.trim();
      const clienteCorreoRaw = pedidoParaStock ? "" : `${data?.clienteCorreo || data?.correo || ""}`.trim();
      const clienteRecord = !pedidoParaStock && data.clienteId
        ? await tx.cliente.findUnique({ where: { id: Number(data.clienteId) }, select: { correo: true } })
        : null;
      const clienteCorreo = clienteCorreoRaw || clienteRecord?.correo || "";
      const ubicacion = this.normalizarUbicacion(data?.ubicacion);
      const postventaId = Number(data?.postventaId || 0) || null;
      const postventaCobro = this.normalizarPostventaCobro(data?.postventaCobro);
      const pedidoSinCobro = postventaCobro === "sin_cobro" || metodoPago === "sin_cobro" || pedidoParaStock;

      if (pedidoSinCobro && !pedidoParaStock && !postventaId) {
        throw new BadRequestException("Selecciona el documento de cambio/devolucion para crear un pedido sin valor monetario");
      }
      if (postventaId) {
        const postventa = await tx.cambioDevolucion.findUnique({
          where: { id: postventaId },
          select: { id: true, estado: true },
        });
        if (!postventa) throw new BadRequestException("El documento de cambio/devolucion seleccionado no existe");
        if (`${postventa.estado || ""}`.trim().toLowerCase() === "anulado") {
          throw new BadRequestException("No se puede vincular un documento de cambio/devolucion anulado");
        }
      }

      const subtotal = detalles.reduce((sum: number, item: any) => {
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
        throw new BadRequestException("Debes registrar un anticipo mayor a 0");
      }
      if (anticipo > totalEstimado) {
        throw new BadRequestException(`El anticipo (Q ${Number(anticipo || 0).toFixed(2)}) no puede superar el total (Q ${totalEstimado.toFixed(2)}).`);
      }
      if (!pedidoSinCobro && this.metodoRequiereReferencia(metodoPago) && !referencia) {
        throw new BadRequestException("La referencia del pago es obligatoria para este metodo");
      }
      if (!pedidoSinCobro && metodoPago === "deposito_bancario" && !banco) {
        throw new BadRequestException("El banco es obligatorio para deposito bancario");
      }

      const pagosExistentes = await tx.pagoPedido.findMany({ where: { pedidoId: pedidoExistente.id }, orderBy: { id: "asc" } });
      const pagoAnticipo = pagosExistentes.find((pago: any) => `${pago.tipo || ""}`.toLowerCase() === "anticipo") || null;
      const otrosPagosTotal = pagosExistentes
        .filter((pago: any) => Number(pago.id) !== Number(pagoAnticipo?.id || 0))
        .reduce((sum: number, pago: any) => sum + Number(pago.monto || 0) + Number(pago.recargo || 0), 0);

      if (pedidoSinCobro || anticipo <= 0) {
        if (pagoAnticipo) await tx.pagoPedido.delete({ where: { id: pagoAnticipo.id } });
      } else if (pagoAnticipo) {
        await tx.pagoPedido.update({
          where: { id: pagoAnticipo.id },
          data: {
            monto: anticipo,
            metodo: metodoPago,
            tipo: "anticipo",
            recargo: porcRecargo > 0 ? anticipo * (porcRecargo / 100) : 0,
            porcentajeRecargo: porcRecargo,
            referencia: this.metodoRequiereReferencia(metodoPago) ? referencia : null,
            banco: metodoPago === "deposito_bancario" ? banco || null : null,
          },
        });
        await this.safeSetPagoPedidoUbicacion(tx, pagoAnticipo.id, ubicacion);
      } else {
        const pago = await tx.pagoPedido.create({
          data: {
            pedidoId: pedidoExistente.id,
            monto: anticipo,
            metodo: metodoPago,
            tipo: "anticipo",
            recargo: porcRecargo > 0 ? anticipo * (porcRecargo / 100) : 0,
            porcentajeRecargo: porcRecargo,
            referencia: this.metodoRequiereReferencia(metodoPago) ? referencia : null,
            banco: metodoPago === "deposito_bancario" ? banco || null : null,
          },
          select: { id: true },
        });
        await this.safeSetPagoPedidoUbicacion(tx, pago.id, ubicacion);
      }

      const totalPagadoFinal = pedidoSinCobro ? 0 : otrosPagosTotal + anticipo;
      const detalleIds = pedidoExistente.detalle.map((item) => item.id);
      if (detalleIds.length) {
        await tx.bordadoDetallePedidoProduccion.deleteMany({ where: { detalleId: { in: detalleIds } } });
      }
      await tx.detallePedidoProduccion.deleteMany({ where: { pedidoId: pedidoExistente.id } });

      const pedidoActualizado = await tx.pedidoProduccion.update({
        where: { id: pedidoExistente.id },
        data: {
          solicitadoPor,
          observaciones: data.observaciones || null,
          clienteId: pedidoParaStock ? null : data.clienteId || null,
          clienteNombre: clienteNombre || "Mostrador",
          clienteTelefono: clienteTelefono || null,
          clienteCorreo: clienteCorreo || null,
          bodegaId: data.bodegaId || null,
          totalEstimado,
          anticipo,
          saldoPendiente: this.roundMoney(Math.max(0, totalEstimado - totalPagadoFinal)),
          recargo: pedidoSinCobro ? 0 : recargo,
          porcentajeRecargo: pedidoSinCobro ? 0 : porcRecargo,
          envio: pedidoSinCobro ? 0 : envio,
          metodoPago: pedidoParaStock ? "sin_cobro_stock" : pedidoSinCobro ? "sin_cobro" : metodoPago,
          postventaId: pedidoParaStock ? null : postventaId,
          postventaCobro: pedidoParaStock ? "normal" : postventaCobro,
        },
      });

      await tx.$executeRaw`UPDATE PedidoProduccion SET ubicacion = ${ubicacion} WHERE id = ${pedidoActualizado.id}`;

      for (const item of detalles) {
        const bordados = this.normalizeBordadosPayload(item, pedidoParaStock);
        const primerBordado = bordados[0] || null;
        const totalBordado = bordados.reduce((sum, bordado) => sum + Number(bordado.monto || 0), 0);
        const descripcion = this.formatDetalleObservaciones(item.descripcion, bordados);
        await tx.detallePedidoProduccion.create({
          data: {
            pedidoId: pedidoActualizado.id,
            productoId: item.productoId,
            cantidad: Number(item.cantidad) || 0,
            precioUnit: pedidoParaStock ? 0 : Number(item.precioUnit) || 0,
            bordado: totalBordado,
            bordadoColor: primerBordado?.color || null,
            bordadoTamano: primerBordado?.tamano || null,
            bordadoPosicion: primerBordado?.posicion || null,
            bordadoObservaciones: primerBordado?.observaciones || null,
            bordadoImagenUrl: primerBordado?.imagenUrl || null,
            bordadoEstado: primerBordado ? primerBordado.estado : null,
            bordadoFechaEntrega: primerBordado ? primerBordado.fechaEntrega : null,
            bordados: bordados.length
              ? {
                  create: bordados.map((bordado) => ({
                    monto: bordado.monto,
                    color: bordado.color || null,
                    tamano: bordado.tamano || null,
                    posicion: bordado.posicion || null,
                    observaciones: bordado.observaciones || null,
                    imagenUrl: bordado.imagenUrl || null,
                    estado: bordado.estado,
                    fechaEntrega: bordado.fechaEntrega,
                  })),
                }
              : undefined,
            estiloEspecial: pedidoParaStock ? false : Boolean(item.estiloEspecial),
            estiloEspecialMonto: pedidoParaStock || !item.estiloEspecial ? 0 : Number(item.estiloEspecialMonto) || 0,
            descuento: pedidoParaStock ? 0 : Number(item.descuento) || 0,
            descripcion,
          },
        });
      }

      return tx.pedidoProduccion.findUnique({
        where: { id: pedidoActualizado.id },
        include: {
          detalle: { include: { producto: true, bordados: true } },
          avances: true,
          mermas: true,
          pagos: { select: PAGO_PEDIDO_COMPAT_SELECT },
          cliente: true,
          usuario: { select: { id: true, nombre: true, usuario: true } },
          bodega: true,
          postventa: true,
          unificaciones: { include: { produccionUnificado: { select: { id: true, correlativo: true } } } },
          ordenesMixtas: { select: { id: true, folio: true, saldoTotal: true, estado: true }, take: 1 },
        },
      });
    });

    if (pedido) {
      (pedido as any).ubicacion = this.normalizarUbicacion(data?.ubicacion);
      this.produccionGateway.emitPedidosActualizados({
        action: "updated",
        pedidoId: pedido.id,
      });
    }

    const pedidosConPagos = await this.hydratePagoPedidoMetadata([pedido]);
    return this.normalizePedidoResponse(pedidosConPagos[0]);
  }

  private async crearPedidoDirecto(data: any, usuarioId?: number, user?: { id?: number; usuario?: string | null; rol?: string | null }) {
    const systemConfig = await this.getSystemConfig();
    const pedidoAlertRoleIds = this.normalizeRoleIds((systemConfig as any).pedidoAlertRoleIds);
    const pedidoParaStockGlobal = this.normalizarMetodoPago(data?.metodoPago) === "sin_cobro_stock";
    // Se declara fuera del if para que siga visible dentro de la transaccion,
    // donde la autorizacion se marca como consumida.
    let autorizacionCliente: Awaited<ReturnType<typeof this.assertClienteCartera>> = null;
    if (!pedidoParaStockGlobal) {
      autorizacionCliente = await this.assertClienteCartera(Number(data?.clienteId || 0) || null, user, Number(data?.autorizacionClienteId || 0));
    }

    const pedido = await this.prisma.$transaction(async (tx) => {
      const detalles = Array.isArray(data.detalle) ? data.detalle : [];
      await this.assertDetallePedidoValido(tx, detalles);
      const metodoPago = this.normalizarMetodoPago(data.metodoPago);
      const pedidoParaStock = metodoPago === "sin_cobro_stock";
      const referencia = `${data?.referenciaPago || data?.referencia || ""}`.trim();
      const banco = `${data?.bancoPago || data?.banco || ""}`.trim();
      const solicitadoPorRaw = `${data?.solicitadoPor || ""}`.trim();
      const solicitadoPor =
        solicitadoPorRaw && solicitadoPorRaw.toLowerCase() !== "stock bajo"
          ? solicitadoPorRaw
          : `${user?.usuario || ""}`.trim() || null;
      const clienteNombre = pedidoParaStock ? "Pedido para stock" : `${data?.clienteNombre || ""}`.trim();
      const clienteTelefono = pedidoParaStock ? "" : `${data?.clienteTelefono || ""}`.trim();
      const clienteCorreoRaw = pedidoParaStock ? "" : `${data?.clienteCorreo || data?.correo || ""}`.trim();
      const clienteRecord = !pedidoParaStock && data.clienteId
        ? await tx.cliente.findUnique({ where: { id: Number(data.clienteId) }, select: { correo: true } })
        : null;
      const clienteCorreo = clienteCorreoRaw || clienteRecord?.correo || "";
      const ubicacion = this.normalizarUbicacion(data?.ubicacion);
      const postventaId = Number(data?.postventaId || 0) || null;
      const postventaCobro = this.normalizarPostventaCobro(data?.postventaCobro);
      const pedidoSinCobro = postventaCobro === "sin_cobro" || metodoPago === "sin_cobro" || pedidoParaStock;
      if (pedidoSinCobro && !pedidoParaStock && !postventaId) {
        throw new BadRequestException("Selecciona el documento de cambio/devolucion para crear un pedido sin valor monetario");
      }
      if (postventaId) {
        const postventa = await tx.cambioDevolucion.findUnique({
          where: { id: postventaId },
          select: { id: true, folio: true, estado: true },
        });
        if (!postventa) {
          throw new BadRequestException("El documento de cambio/devolucion seleccionado no existe");
        }
        if (`${postventa.estado || ""}`.trim().toLowerCase() === "anulado") {
          throw new BadRequestException("No se puede vincular un documento de cambio/devolucion anulado");
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
        throw new BadRequestException("Debes registrar un anticipo mayor a 0");
      }
      if (anticipo > totalEstimado) {
        throw new BadRequestException(
          `El anticipo (Q ${Number(anticipo || 0).toFixed(2)}) no puede superar el total (Q ${totalEstimado.toFixed(2)}).`
        );
      }
      if (!pedidoSinCobro && this.metodoRequiereReferencia(metodoPago) && !referencia) {
        throw new BadRequestException("La referencia del pago es obligatoria para este metodo");
      }
      if (!pedidoSinCobro && metodoPago === "deposito_bancario" && !banco) {
        throw new BadRequestException("El banco es obligatorio para deposito bancario");
      }

      const folio = await this.generarCorrelativoUsuarioOperacion(tx, usuarioId, "pedido", "PE");
      const pedido = await tx.pedidoProduccion.create({
        data: {
          folio,
          solicitadoPor,
          observaciones: data.observaciones || null,
          clienteId: pedidoParaStock ? null : data.clienteId || null,
          clienteNombre: clienteNombre || "Mostrador",
          clienteTelefono: clienteTelefono || null,
          clienteCorreo: clienteCorreo || null,
          usuarioId: Number(usuarioId || 0) || null,
          bodegaId: data.bodegaId || null,
          totalEstimado,
          anticipo,
          saldoPendiente: this.roundMoney(totalEstimado - anticipo),
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
        const bordados = this.normalizeBordadosPayload(item, pedidoParaStock);
        const primerBordado = bordados[0] || null;
        const totalBordado = bordados.reduce((sum, bordado) => sum + Number(bordado.monto || 0), 0);
        const descripcion = this.formatDetalleObservaciones(item.descripcion, bordados);
        await tx.detallePedidoProduccion.create({
          data: {
            pedidoId: pedido.id,
            productoId: item.productoId,
            cantidad: Number(item.cantidad) || 0,
            precioUnit: pedidoParaStock ? 0 : Number(item.precioUnit) || 0,
            bordado: totalBordado,
            bordadoColor: primerBordado?.color || null,
            bordadoTamano: primerBordado?.tamano || null,
            bordadoPosicion: primerBordado?.posicion || null,
            bordadoObservaciones: primerBordado?.observaciones || null,
            bordadoImagenUrl: primerBordado?.imagenUrl || null,
            bordadoEstado: primerBordado ? primerBordado.estado : null,
            bordadoFechaEntrega: primerBordado ? primerBordado.fechaEntrega : null,
            bordados: bordados.length
              ? {
                  create: bordados.map((bordado) => ({
                    monto: bordado.monto,
                    color: bordado.color || null,
                    tamano: bordado.tamano || null,
                    posicion: bordado.posicion || null,
                    observaciones: bordado.observaciones || null,
                    imagenUrl: bordado.imagenUrl || null,
                    estado: bordado.estado,
                    fechaEntrega: bordado.fechaEntrega,
                  })),
                }
              : undefined,
            estiloEspecial: pedidoParaStock ? false : Boolean(item.estiloEspecial),
            estiloEspecialMonto: pedidoParaStock || !item.estiloEspecial ? 0 : Number(item.estiloEspecialMonto) || 0,
            descuento: pedidoParaStock ? 0 : Number(item.descuento) || 0,
            descripcion,
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
            banco: metodoPago === "deposito_bancario" ? banco || null : null,
          },
          select: { id: true },
        });
        await this.safeSetPagoPedidoUbicacion(tx, pago.id, ubicacion);
      }
      if (autorizacionCliente) await tx.autorizacionVentaCliente.update({ where: { id: autorizacionCliente.id }, data: { estado: 'consumido', operacionId: pedido.id, consumidoEn: new Date() } });

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
          clienteCorreo: true,
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
      await this.trackingService.ensureTrackingForPedido(pedido.id, {
        estado: "pedido_ingresado",
        titulo: "Pedido ingresado",
        mensaje: "Tu pedido fue ingresado al sistema de Uniforma. Recibiras actualizaciones por correo conforme avance.",
        sendEmail: true,
      });
      this.produccionGateway.emitPedidosActualizados({
        action: 'created',
        pedidoId: pedido.id,
      });
    }

    return pedido;
  }

  private buildPedidoQueryWhere(baseWhere: any, query: any = {}) {
    const and: any[] = [];
    if (baseWhere && Object.keys(baseWhere).length) and.push(baseWhere);

    const folio = `${query.folio || query.pedidoFolio || query.searchFolio || ''}`.trim();
    const unificacion = `${query.unificacion || query.unificado || query.unificadoCorrelativo || ''}`.trim();
    const busquedaDocumento = Boolean(folio || unificacion);
    const fechaInicio = `${query.fechaInicio || query.desde || ''}`.trim();
    const fechaFin = `${query.fechaFin || query.hasta || ''}`.trim();
    const fecha: any = {};
    if (fechaInicio) {
      const parsed = parseGuatemalaDate(fechaInicio);
      if (parsed) fecha.gte = parsed;
    }
    if (fechaFin) {
      const parsed = parseGuatemalaDate(fechaFin, true);
      if (parsed) fecha.lte = parsed;
    }
    if (Object.keys(fecha).length && !busquedaDocumento) and.push({ fecha });

    const cliente = `${query.cliente || query.qCliente || query.searchCliente || ''}`.trim();
    if (cliente) {
      and.push({
        OR: [
          { clienteNombre: { contains: cliente } },
          { cliente: { nombre: { contains: cliente } } },
          { cliente: { telefono: { contains: cliente } } },
        ],
      });
    }

    if (folio) {
      and.push({ folio: { contains: folio } });
    }

    if (unificacion) {
      and.push({
        OR: [
          { unificadoCorrelativo: { contains: unificacion } },
          { unificaciones: { some: { produccionUnificado: { correlativo: { contains: unificacion } } } } },
        ],
      });
    }

    const bodegaId = Number(query.bodegaId || 0);
    if (Number.isInteger(bodegaId) && bodegaId > 0) and.push({ bodegaId });

    const tipoPedido = `${query.tipoPedido || ''}`.trim().toLowerCase();
    if (tipoPedido === 'stock') {
      and.push({ metodoPago: 'sin_cobro_stock' });
    } else if (tipoPedido === 'clientes') {
      and.push({
        OR: [
          { metodoPago: null },
          { metodoPago: { not: 'sin_cobro_stock' } },
        ],
      });
    }

    return and.length ? { AND: and } : {};
  }

  async listarPedidos(user?: { id?: number; rol?: string | null; rolId?: number | null; permisos?: string[] | null }, query: any = {}) {
    const where = this.buildPedidoQueryWhere(await this.buildPedidoUsuarioWhere(user), query);
    const pagination = parsePaginationQuery(query);
    const lite = parseBooleanQuery(query.lite);
    if (lite) {
      const args: any = {
        where,
        select: {
          id: true,
          folio: true,
          fecha: true,
          estado: true,
          totalEstimado: true,
          anticipo: true,
          saldoPendiente: true,
          bodegaId: true,
          clienteNombre: true,
          solicitadoPor: true,
          usuarioId: true,
          postventaId: true,
          postventaCobro: true,
          bodega: { select: { id: true, nombre: true } },
          cliente: { select: { id: true, nombre: true } },
          usuario: { select: { id: true, nombre: true, usuario: true } },
          postventa: { select: { id: true, folio: true, tipo: true } },
          ordenesMixtas: { select: { id: true, folio: true, saldoTotal: true, estado: true }, take: 1 },
        },
        orderBy: { id: "desc" },
      };
      if (pagination) {
        const [total, pedidos] = await Promise.all([
          this.prisma.pedidoProduccion.count({ where }),
          this.prisma.pedidoProduccion.findMany({ ...args, skip: pagination.skip, take: pagination.take }),
        ]);
        return paginatedResponse(pedidos.map((pedido) => this.normalizePedidoResponse(pedido)), total, pagination.page, pagination.pageSize);
      }
      const pedidos = await this.prisma.pedidoProduccion.findMany(args);
      return pedidos.map((pedido) => this.normalizePedidoResponse(pedido));
    }

    const pedidos = await this.prisma.pedidoProduccion.findMany({
      where,
      include: {
        detalle: { include: { producto: true, bordados: true } },
        avances: true,
        mermas: true,
        pagos: { select: PAGO_PEDIDO_COMPAT_SELECT },
        cliente: true,
        usuario: { select: { id: true, nombre: true, usuario: true } },
        bodega: true,
        postventa: true,
        unificaciones: { include: { produccionUnificado: { select: { id: true, correlativo: true } } } },
        ordenesMixtas: { select: { id: true, folio: true, saldoTotal: true, estado: true }, take: 1 },
      },
      orderBy: { id: "desc" },
      ...(pagination ? { skip: pagination.skip, take: pagination.take } : {}),
    });
    const pedidosConPagos = await this.hydratePagoPedidoMetadata(pedidos);
    const rows = pedidosConPagos.map((pedido) =>
      this.normalizePedidoResponse({
        ...pedido,
      }),
    );
    if (!pagination) return rows;
    const total = await this.prisma.pedidoProduccion.count({ where });
    return paginatedResponse(rows, total, pagination.page, pagination.pageSize);
  }

  async listarBordados(
    user?: { id?: number; rol?: string | null; rolId?: number | null; permisos?: string[] | null },
    usuarioIdFiltro?: number | null,
    filtros?: { fechaInicio?: string | null; fechaFin?: string | null },
  ) {
    const usuarioId = Number(usuarioIdFiltro || 0);
    const canFilterUsuarios = this.canFilterBordadosByUsuario(user);
    const where =
      canFilterUsuarios && Number.isInteger(usuarioId) && usuarioId > 0
        ? await this.buildPedidoUsuarioOwnerWhere(usuarioId)
        : canFilterUsuarios
          ? {}
          : await this.buildPedidoUsuarioWhere(user);
    const fechaWhere: Record<string, Date> = {};
    let fechaInicio = `${filtros?.fechaInicio || ""}`.trim();
    let fechaFin = `${filtros?.fechaFin || ""}`.trim();
    if (!fechaInicio && !fechaFin) {
      const { start, end } = this.getTodayDateRange();
      fechaWhere.gte = start;
      fechaWhere.lte = end;
    }
    if (fechaInicio) {
      const date = parseGuatemalaDate(fechaInicio);
      if (date) fechaWhere.gte = date;
    }
    if (fechaFin) {
      const date = parseGuatemalaDate(fechaFin, true);
      if (date) fechaWhere.lte = date;
    }
    const pedidoBordadoWhere = {
      OR: [
        { bordado: { gt: 0 } },
        { bordadoColor: { not: null } },
        { bordadoTamano: { not: null } },
        { bordadoPosicion: { not: null } },
        { bordadoImagenUrl: { not: null } },
        { bordados: { some: {} } },
      ],
    };
    const ventaBordadoWhere = {
      OR: [
        { bordado: { gt: 0 } },
        { bordadoColor: { not: null } },
        { bordadoTamano: { not: null } },
        { bordadoPosicion: { not: null } },
        { bordadoImagenUrl: { not: null } },
        { bordados: { some: {} } },
      ],
    };
    const pedidos = await this.prisma.pedidoProduccion.findMany({
      where: {
        AND: [
          where,
          ...(Object.keys(fechaWhere).length ? [{ fecha: fechaWhere }] : []),
          {
            detalle: {
              some: pedidoBordadoWhere,
            },
          },
        ],
      } as any,
      include: {
        cliente: true,
        usuario: { select: { id: true, nombre: true, usuario: true } },
        bodega: true,
        detalle: {
          where: pedidoBordadoWhere,
          include: {
            bordados: true,
            producto: {
              include: { tela: true, talla: true, color: true },
            },
          },
        },
      },
      orderBy: { fecha: "desc" },
    });

    const ventaWhere =
      canFilterUsuarios && Number.isInteger(usuarioId) && usuarioId > 0
        ? await this.buildVentaUsuarioOwnerWhere(usuarioId)
        : canFilterUsuarios
          ? {}
          : await this.buildVentaUsuarioWhere(user);
    const ventas = await this.prisma.venta.findMany({
      where: {
        AND: [
          ventaWhere,
          ...(Object.keys(fechaWhere).length ? [{ fecha: fechaWhere }] : []),
          {
            detalle: {
              some: ventaBordadoWhere,
            },
          },
        ],
      } as any,
      include: {
        cliente: true,
        bodega: true,
        detalle: {
          where: ventaBordadoWhere,
          include: {
            bordados: true,
            producto: {
              include: { tela: true, talla: true, color: true },
            },
          },
        },
      },
      orderBy: { fecha: "desc" },
    });

    return [
      ...pedidos.map((pedido) => ({ ...this.normalizePedidoResponse(pedido), origen: "pedido" })),
      ...ventas.map((row) => this.normalizeVentaBordadoResponse(row)),
    ].sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  }

  async actualizarDetalleBordado(
    detalleId: number,
    data: {
      bordadoEstado?: string | null;
      bordadoFechaEntrega?: string | null;
    },
    user?: { id?: number; rol?: string | null; rolId?: number | null; permisos?: string[] | null },
  ) {
    const detalle = await this.prisma.detallePedidoProduccion.findUnique({
      where: { id: Number(detalleId) },
      include: { pedido: { select: { id: true, estado: true } } },
    });

    if (!detalle) {
      throw new Error("Detalle de bordado no encontrado");
    }

    if (`${detalle.pedido.estado || ""}`.trim().toLowerCase() === "anulado") {
      throw new Error("No se puede actualizar el bordado de un pedido anulado");
    }

    if (!this.canManageBordados(user)) {
      await this.assertPedidoAccess(detalle.pedido.id, user);
    }

    const bordadoEstado = this.normalizeBordadoEstado(data?.bordadoEstado);
    const bordadoFechaEntrega = this.parseBordadoFechaEntrega(data?.bordadoFechaEntrega);

    await this.prisma.bordadoDetallePedidoProduccion.updateMany({
      where: { detalleId: Number(detalleId) },
      data: {
        estado: bordadoEstado,
        fechaEntrega: bordadoFechaEntrega,
      },
    });

    return this.prisma.detallePedidoProduccion.update({
      where: { id: Number(detalleId) },
      data: {
        bordadoEstado,
        bordadoFechaEntrega,
      },
      include: {
        bordados: true,
        producto: {
          include: { tela: true, talla: true, color: true },
        },
      },
    }).then((item) => this.normalizeDetallePedido(item));
  }

  async actualizarDetalleVentaBordado(
    detalleId: number,
    data: {
      bordadoEstado?: string | null;
      bordadoFechaEntrega?: string | null;
    },
    user?: { id?: number; rol?: string | null; rolId?: number | null; permisos?: string[] | null },
  ) {
    const detalle = await this.prisma.detalleVenta.findUnique({
      where: { id: Number(detalleId) },
      include: { venta: { select: { id: true } } },
    });

    if (!detalle) {
      throw new Error("Detalle de bordado de venta no encontrado");
    }

    if (!this.canManageBordados(user)) {
      const ventaWhere = await this.buildVentaUsuarioWhere(user);
      const count = await this.prisma.venta.count({
        where: {
          AND: [{ id: detalle.venta.id }, ventaWhere],
        } as any,
      });
      if (count <= 0) {
        throw new Error("No tienes acceso a esta venta");
      }
    }

    const bordadoEstado = this.normalizeBordadoEstado(data?.bordadoEstado);
    const bordadoFechaEntrega = this.parseBordadoFechaEntrega(data?.bordadoFechaEntrega);

    await this.prisma.bordadoDetalleVenta.updateMany({
      where: { detalleId: Number(detalleId) },
      data: {
        estado: bordadoEstado,
        fechaEntrega: bordadoFechaEntrega,
      },
    });

    return this.prisma.detalleVenta.update({
      where: { id: Number(detalleId) },
      data: {
        bordadoEstado,
        bordadoFechaEntrega,
      },
      include: {
        bordados: true,
        producto: {
          include: { tela: true, talla: true, color: true },
        },
      },
    }).then((item) => this.normalizeDetalleVentaBordado(item));
  }

  async detallePedido(id: number) {
    const pedido = await this.prisma.pedidoProduccion.findUnique({
      where: { id },
      include: {
        detalle: { include: { producto: true, bordados: true } },
        avances: true,
        mermas: true,
        pagos: { select: PAGO_PEDIDO_COMPAT_SELECT },
        cliente: true,
        bodega: true,
        postventa: true,
        unificaciones: { include: { produccionUnificado: { select: { id: true, correlativo: true } } } },
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
    await this.trackingService.ensureTrackingForPedido(id, {
      estado: "anulado",
      titulo: "Pedido anulado",
      mensaje: "Tu pedido fue marcado como anulado. Si tienes dudas, comunicate con tu asesor.",
      sendEmail: true,
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
    await this.trackingService.ensureTrackingForPedido(id, {
      estado: "regresado_produccion",
      titulo: "Pedido regresado a produccion",
      mensaje: motivo || "Tu pedido fue regresado a produccion para revision.",
      sendEmail: true,
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
      const estadoActual = `${pedido.estado || ""}`.trim().toLowerCase();
      if (["recibido", "completado", "pendiente_pago"].includes(estadoActual)) {
        throw new Error("Este pedido ya fue marcado como recibido");
      }

      const pedidoParaStock = this.normalizarMetodoPago(pedido.metodoPago) === "sin_cobro_stock";
      const ingresarInventario = pedidoParaStock && Boolean(data?.ingresarInventario);
      const bodegaId = Number(data?.bodegaId || pedido.bodegaId || 0);
      if (ingresarInventario && (!Number.isInteger(bodegaId) || bodegaId <= 0)) {
        throw new Error("Selecciona una bodega valida para ingresar el inventario");
      }

      await tx.pedidoProduccion.update({
        where: { id },
        data: {
          estado: this.hasPendingBalance(pedido.saldoPendiente) ? "pendiente_pago" : "recibido",
          observaciones: data.observaciones ?? pedido.observaciones ?? null,
        },
      });

      if (ingresarInventario) {
        const ingreso = await tx.ingresoInventario.create({
          data: {
            bodegaId,
            responsable: data?.responsable || "Produccion",
            observaciones: `Ingreso automatico desde pedido para stock ${pedido.folio || `P-${pedido.id}`}`,
          },
          select: { id: true },
        });

        for (const item of pedido.detalle) {
          const cantidad = Number(item.cantidad || 0);
          if (cantidad <= 0) continue;
          await tx.inventario.upsert({
            where: { bodegaId_productoId: { bodegaId, productoId: item.productoId } },
            update: { stock: { increment: cantidad } },
            create: { bodegaId, productoId: item.productoId, stock: cantidad },
          });
          await tx.detalleIngreso.create({
            data: {
              ingresoId: ingreso.id,
              productoId: item.productoId,
              cantidad,
            },
          });
          await tx.movInventario.create({
            data: {
              bodegaId,
              productoId: item.productoId,
              tipo: "ENTRADA PRODUCCION STOCK",
              cantidad,
              referencia: pedido.folio || `PEDIDO ${pedido.id}`,
            },
          });
        }
      }

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

      return {
        mensaje: ingresarInventario
          ? "Pedido marcado como recibido e ingresado al inventario"
          : "Pedido marcado como recibido",
        inventarioIngresado: ingresarInventario,
      };
    });

    this.produccionGateway.emitPedidosActualizados({
      action: 'completed',
      pedidoId: id,
    });
    await this.trackingService.ensureTrackingForPedido(id, {
      estado: "pedido_recibido",
      titulo: "Pedido listo",
      mensaje: "Tu pedido fue marcado como listo/recibido.",
      sendEmail: true,
    });

    return result;
  }

  async registrarPago(
    id: number,
    data: {
      monto: number;
      metodo: string;
      tipo?: string;
      porcentajeRecargo?: number;
      referencia?: string;
      referenciaPago?: string;
      banco?: string;
      bancoPago?: string;
      ubicacion?: string;
      numeroEnvio?: string;
      numeroRecibo?: string;
      referenciaDocumento?: string;
      observacionesPago?: string;
    },
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const pedido = await tx.pedidoProduccion.findUnique({ where: { id }, include: { pagos: { select: PAGO_PEDIDO_COMPAT_SELECT }, bodega: true } });
      if (!pedido) throw new Error(`Pedido ${id} no existe`);

      const monto = this.roundMoney(data.monto);
      const metodo = this.normalizarMetodoPago(data.metodo);
      const referencia = `${data.referenciaPago || data.referencia || ""}`.trim();
      const banco = `${data.bancoPago || data.banco || ""}`.trim();
      const ubicacion = this.normalizarUbicacion(data.ubicacion || pedido.ubicacion || pedido.bodega?.ubicacion || pedido.bodega?.nombre);
      const porcRecargo = this.metodoUsaRecargo(metodo) ? Number(data.porcentajeRecargo || 0) : 0;
      const recargo = this.roundMoney(monto * (porcRecargo / 100));
      const aplicado = this.roundMoney(monto + recargo);
      const saldoActual = this.resolverSaldoPendientePedido(pedido);
      if (aplicado - saldoActual > 0.005) {
        throw new Error(`El pago mas recargo no puede superar el saldo pendiente Q ${saldoActual.toFixed(2)}`);
      }
      if (metodo === "deposito_bancario" && !banco) {
        throw new Error("El banco es obligatorio para deposito bancario");
      }
      const nuevoSaldo = this.roundMoney(Math.max(0, saldoActual - aplicado));
      if (this.metodoRequiereReferencia(metodo) && !referencia) {
        throw new Error("La referencia del pago es obligatoria para este metodo");
      }
      if (monto <= 0) throw new Error("Monto inválido");

      const pago = await tx.pagoPedido.create({
        data: {
          pedidoId: id,
          monto,
          metodo,
          tipo: data.tipo || "saldo",
          recargo,
          porcentajeRecargo: porcRecargo,
          referencia: this.metodoRequiereReferencia(metodo) ? referencia : null,
          banco: metodo === "deposito_bancario" ? banco : null,
          numeroEnvio: `${data.numeroEnvio || ""}`.trim() || null,
          numeroRecibo: `${data.numeroRecibo || ""}`.trim() || null,
          referenciaDocumento: `${data.referenciaDocumento || ""}`.trim() || null,
          observacionesPago: `${data.observacionesPago || ""}`.trim() || null,
        },
        select: { id: true },
      });
      await this.safeSetPagoPedidoUbicacion(tx, pago.id, ubicacion);

      await tx.pedidoProduccion.update({
        where: { id },
        data: {
          saldoPendiente: nuevoSaldo,
          estado: !this.hasPendingBalance(nuevoSaldo) && `${pedido.estado || ""}`.trim().toLowerCase() !== "anulado" ? "recibido" : pedido.estado,
        },
      });

      return { saldoPendiente: nuevoSaldo };
    });

    this.produccionGateway.emitPedidosActualizados({
      action: 'payment',
      pedidoId: id,
    });
    await this.trackingService.ensureTrackingForPedido(id, {
      estado: "pago_registrado",
      titulo: "Pago registrado",
      mensaje: `Se registro un pago para tu pedido. Saldo pendiente: Q ${Number(result.saldoPendiente || 0).toFixed(2)}.`,
      sendEmail: true,
    });

    return result;
  }
}
