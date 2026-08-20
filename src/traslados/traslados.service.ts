import { BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { assertBodegaAccess, getAllowedBodegaIds } from "../bodegas/bodega-access";
import { CorrelativosService } from "../correlativos/correlativos.service";
import { AlertasService } from "../alertas/alertas.service";

@Injectable()
export class TrasladosService {
  private readonly logger = new Logger(TrasladosService.name);
  private notifier: NotificationService;
  private readonly trasladoInclude = {
    detalle: {
      include: {
        producto: {
          include: {
            tela: true,
            talla: true,
            color: true,
          },
        },
      },
    },
    desdeBodega: true,
    haciaBodega: true,
    solicitudTraslado: {
      include: {
        venta: true,
      },
    },
  };

  private readonly solicitudInclude = {
    venta: true,
    desdeBodega: true,
    haciaBodega: true,
    detalle: {
      include: {
        producto: {
          include: {
            tela: true,
            talla: true,
            color: true,
          },
        },
      },
    },
    traslados: true,
  };

  constructor(
    private prisma: PrismaService,
    private correlativos: CorrelativosService,
    private alertas: AlertasService,
  ) {
    this.notifier = new NotificationService(prisma);
  }

  /**
   * Las notificaciones nunca deben tumbar la operacion de negocio: si el envio
   * falla, la solicitud ya quedo registrada y se puede consultar en el listado.
   */
  private async avisar(params: {
    usuarioIds: number[];
    tipo: string;
    titulo: string;
    mensaje: string;
    payload?: Record<string, unknown>;
  }) {
    try {
      await this.alertas.crearAlertasPorUsuarios(params);
    } catch (e: any) {
      this.logger.error(`No se pudo enviar la alerta ${params.tipo}`, e?.message || e);
    }
  }

  /** Personal de una bodega: los asignados como principal mas los que tienen acceso extra para trasladar. */
  private async resolveUsuariosDeBodega(bodegaId: number) {
    const [principales, extra] = await Promise.all([
      this.prisma.usuario.findMany({ where: { bodegaId, activo: true }, select: { id: true } }),
      this.prisma.usuarioBodega.findMany({
        where: { bodegaId, puedeTrasladar: true, usuario: { activo: true } },
        select: { usuarioId: true },
      }),
    ]);
    return Array.from(new Set([...principales.map((u) => u.id), ...extra.map((u) => u.usuarioId)]));
  }

  private async nombreDe(usuarioId: number, respaldo?: any) {
    const directo = `${respaldo?.nombre || respaldo?.usuario || ""}`.trim();
    if (directo) return directo;
    const u = await this.prisma.usuario.findUnique({ where: { id: Number(usuarioId) }, select: { nombre: true, usuario: true } });
    return `${u?.nombre || u?.usuario || "Un usuario"}`.trim();
  }

  private isAdmin(user?: { rol?: string | null }) {
    return `${user?.rol || ""}`.trim().toUpperCase() === "ADMIN";
  }

  private async isCurrentAdmin(user?: { id?: number; rol?: string | null }) {
    if (this.isAdmin(user)) return true;
    const userId = Number(user?.id || 0);
    if (!userId) return false;
    const current = await this.prisma.usuario.findUnique({
      where: { id: userId },
      select: { rol: { select: { nombre: true } } },
    });
    return `${current?.rol?.nombre || ""}`.trim().toUpperCase() === "ADMIN";
  }

  private hasPermission(user: { permisos?: string[] | null } | undefined, permission: string) {
    return Array.isArray(user?.permisos) && user.permisos.includes(permission);
  }

  private async buildTrasladoWhere(
    query: any = {},
    user?: { id?: number; rol?: string | null; permisos?: string[] | null },
  ) {
    const where: any = {};
    const desde = query.desde ? new Date(`${query.desde}T00:00:00`) : null;
    const hasta = query.hasta ? new Date(`${query.hasta}T23:59:59.999`) : null;
    if (desde || hasta) {
      where.fecha = {
        ...(desde ? { gte: desde } : {}),
        ...(hasta ? { lte: hasta } : {}),
      };
    }

    const desdeBodegaId = Number(query.desdeBodegaId || 0);
    const haciaBodegaId = Number(query.haciaBodegaId || 0);
    if (desdeBodegaId > 0) where.desdeBodegaId = desdeBodegaId;
    if (haciaBodegaId > 0) where.haciaBodegaId = haciaBodegaId;

    const responsable = `${query.responsable || ""}`.trim();
    if (responsable) where.responsable = { contains: responsable };

    const baseWhere = this.isAdmin(user) || this.hasPermission(user, "sistema.multi-tienda") ? {} : await this.buildBodegaAccessWhere(user);
    if (Object.keys(baseWhere).length) {
      where.AND = [...(where.AND || []), baseWhere];
    }

    return where;
  }

  private async buildBodegaAccessWhere(user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    if (this.isAdmin(user) || this.hasPermission(user, "sistema.multi-tienda")) return {};

    const allowedBodegas = await getAllowedBodegaIds(this.prisma, user, "traslados");
    if (allowedBodegas === null) return {};
    if (!allowedBodegas.length) return { id: -1 };

    return {
      OR: [{ desdeBodegaId: { in: allowedBodegas } }, { haciaBodegaId: { in: allowedBodegas } }],
    };
  }

  private async moverStock(
    desdeBodegaId: number,
    haciaBodegaId: number,
    detalle: Array<{ productoId: number; cantidad: number }>,
    referencia: string,
  ) {
    for (const item of detalle) {
      const productoId = Number(item.productoId);
      const cantidad = Number(item.cantidad || 0);
      if (!productoId || cantidad <= 0) {
        throw new BadRequestException("El detalle del traslado contiene productos o cantidades invalidas");
      }

      const invOrigen = await this.prisma.inventario.findUnique({
        where: {
          bodegaId_productoId: {
            bodegaId: desdeBodegaId,
            productoId,
          },
        },
      });

      if (!invOrigen || invOrigen.stock < cantidad) {
        const disponible = invOrigen?.stock ?? 0;
        throw new BadRequestException(
          `Stock insuficiente en bodega origen para producto ${productoId}. Disponible: ${disponible}`,
        );
      }

      await this.prisma.inventario.update({
        where: {
          bodegaId_productoId: {
            bodegaId: desdeBodegaId,
            productoId,
          },
        },
        data: { stock: { decrement: cantidad } },
      });

      await this.prisma.inventario.upsert({
        where: {
          bodegaId_productoId: {
            bodegaId: haciaBodegaId,
            productoId,
          },
        },
        update: { stock: { increment: cantidad } },
        create: {
          bodegaId: haciaBodegaId,
          productoId,
          stock: cantidad,
        },
      });

      await this.prisma.movInventario.createMany({
        data: [
          {
            bodegaId: desdeBodegaId,
            productoId,
            tipo: "traslado_salida",
            cantidad,
            referencia,
          },
          {
            bodegaId: haciaBodegaId,
            productoId,
            tipo: "traslado_entrada",
            cantidad,
            referencia,
          },
        ],
      });

      const invCheck = await this.prisma.inventario.findUnique({
        where: {
          bodegaId_productoId: { bodegaId: desdeBodegaId, productoId },
        },
      });
      const minimo = await this.prisma.stockMinimoBodegaProducto.findUnique({
        where: { bodegaId_productoId: { bodegaId: desdeBodegaId, productoId } },
      });
      const threshold = Number(minimo?.minimo ?? process.env.STOCK_ALERT_THRESHOLD ?? 5);
      if (invCheck && invCheck.stock < threshold) {
        await this.notifier.notifyLowStock([{ bodegaId: desdeBodegaId, productoId }]);
      }
    }
  }

  /**
   * Descuenta el stock que una venta dejo pendiente en la bodega origen. Solo
   * se llama al aprobar una solicitud ligada a una venta (ventaId): no hay
   * bodega destino que reciba, el producto ya salio por esa venta.
   */
  /**
   * La bodega puente donde espera la mercaderia mientras viaja.
   *
   * Devuelve null si todavia no se configuro ninguna, y en ese caso el traslado
   * se comporta como antes (el stock salta de una tienda a otra al recibir).
   * Asi la funcion no depende de que exista la configuracion para operar.
   */
  private bodegaTransito() {
    return this.prisma.bodega.findFirst({ where: { esTransito: true, activa: true } });
  }

  /** Cancelar es cosa de cualquiera de las dos partes, no de ambas a la vez. */
  private async assertAlgunaBodega(
    user: { id?: number; rol?: string | null; permisos?: string[] | null } | undefined,
    desdeBodegaId: number,
    haciaBodegaId: number,
  ) {
    try {
      await assertBodegaAccess(this.prisma, user, desdeBodegaId, "traslados");
      return;
    } catch {
      await assertBodegaAccess(this.prisma, user, haciaBodegaId, "traslados");
    }
  }

  private async liquidarStockVentaEnTransaccion(tx: any, solicitud: any) {
    const referencia = solicitud.observaciones || `Venta ligada a ${solicitud.folio || `solicitud #${solicitud.id}`}`;
    for (const item of solicitud.detalle as any[]) {
      const cantidad = Number(item.cantidad || 0);
      if (cantidad <= 0) continue;

      const result = await tx.inventario.updateMany({
        where: { bodegaId: solicitud.desdeBodegaId, productoId: item.productoId, stock: { gte: cantidad } },
        data: { stock: { decrement: cantidad } },
      });
      if (result.count !== 1) {
        const actual = await tx.inventario.findUnique({
          where: { bodegaId_productoId: { bodegaId: solicitud.desdeBodegaId, productoId: item.productoId } },
          select: { stock: true },
        });
        throw new BadRequestException(
          `Stock insuficiente en ${solicitud.desdeBodega?.nombre || "la bodega origen"} para ${item.producto?.nombre || `producto ${item.productoId}`}. Disponible: ${Number(actual?.stock || 0)}. Solicitado: ${cantidad}.`,
        );
      }

      await tx.movInventario.create({
        data: { bodegaId: solicitud.desdeBodegaId, productoId: item.productoId, tipo: "venta_salida", cantidad, referencia },
      });
      await tx.detalleSolicitudTraslado.update({
        where: { id: item.id },
        data: { cantidadRecibida: cantidad, estado: "RECIBIDO" },
      });
    }
  }

  /**
   * Solicitud manual: una tienda pide un producto que tiene otra, sin pasar
   * por una venta. Siempre nace PENDIENTE_APROBACION porque, a diferencia del
   * traslado directo, quien pide no tiene por que tener acceso a la bodega
   * origen: es justo lo que se le esta pidiendo permiso de usar.
   */
  async crearSolicitud(data: any, user?: { id?: number; rol?: string | null; permisos?: string[] | null; usuario?: string; nombre?: string }) {
    const desdeBodegaId = Number(data.desdeBodegaId || 0);
    const haciaBodegaId = Number(data.haciaBodegaId || 0);
    if (!desdeBodegaId || !haciaBodegaId) {
      throw new BadRequestException("Selecciona la tienda que tiene el producto y la tienda que lo solicita");
    }
    if (desdeBodegaId === haciaBodegaId) {
      throw new BadRequestException("No puedes solicitar un traslado de una tienda hacia si misma");
    }
    await assertBodegaAccess(this.prisma, user, haciaBodegaId, "traslados");

    const desdeBodega = await this.prisma.bodega.findUnique({ where: { id: desdeBodegaId } });
    if (!desdeBodega || !desdeBodega.activa) {
      throw new BadRequestException("La tienda a la que le pides el producto no existe o esta inactiva");
    }

    const detalle = Array.isArray(data.detalle) ? data.detalle : [];
    if (!detalle.length) throw new BadRequestException("Agrega al menos un producto a la solicitud");
    for (const item of detalle) {
      if (!Number(item.productoId) || !(Number(item.cantidad) > 0)) {
        throw new BadRequestException("La solicitud contiene productos o cantidades invalidas");
      }
    }

    const mensaje = `${data.observaciones || data.mensaje || ""}`.trim();
    const solicitanteId = Number(user?.id || 0) || null;

    const solicitud = await this.prisma.solicitudTraslado.create({
      data: {
        desdeBodegaId,
        haciaBodegaId,
        estado: "PENDIENTE_APROBACION",
        responsable: data.responsable || null,
        solicitanteId,
        observaciones: mensaje || null,
        detalle: {
          create: detalle.map((item: any) => ({
            productoId: Number(item.productoId),
            cantidad: Number(item.cantidad),
          })),
        },
      },
      include: this.solicitudInclude,
    });

    const destinatarios = await this.resolveUsuariosDeBodega(desdeBodegaId);
    if (destinatarios.length) {
      const solicitante = await this.nombreDe(solicitanteId || 0, user);
      const haciaBodega = await this.prisma.bodega.findUnique({ where: { id: haciaBodegaId }, select: { nombre: true } });
      const items = (solicitud.detalle as any[]).map((item) => ({
        codigo: item.producto?.codigo || `${item.productoId}`,
        nombre: item.producto?.nombre || "Producto",
        cantidad: item.cantidad,
      }));
      const resumenItems = items.map((i) => `${i.cantidad}x ${i.nombre}`).join(", ");

      await this.avisar({
        usuarioIds: destinatarios,
        tipo: "solicitud_traslado",
        titulo: "Solicitud de traslado",
        mensaje: `${solicitante} de ${haciaBodega?.nombre || "otra tienda"} solicita: ${resumenItems}.${mensaje ? ` Mensaje: ${mensaje}` : ""}`,
        payload: {
          solicitudTrasladoId: solicitud.id,
          prioridad: "alta",
          desdeBodega: desdeBodega.nombre,
          haciaBodega: haciaBodega?.nombre || "",
          solicitante,
          solicitanteId,
          mensaje,
          items,
        },
      });
    }

    return solicitud;
  }

  async findAll(query: any = {}, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    return this.prisma.traslado.findMany({
      where: await this.buildTrasladoWhere(query, user),
      include: this.trasladoInclude,
      orderBy: { fecha: "desc" },
    });
  }

  async findSolicitudes(query: any = {}, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const where: any = {};
    const desde = query.desde ? new Date(`${query.desde}T00:00:00`) : null;
    const hasta = query.hasta ? new Date(`${query.hasta}T23:59:59.999`) : null;
    if (desde || hasta) {
      where.fecha = {
        ...(desde ? { gte: desde } : {}),
        ...(hasta ? { lte: hasta } : {}),
      };
    }
    if (query.estado) where.estado = `${query.estado}`.trim().toUpperCase();
    const desdeBodegaId = Number(query.desdeBodegaId || 0);
    const haciaBodegaId = Number(query.haciaBodegaId || 0);
    if (desdeBodegaId > 0) where.desdeBodegaId = desdeBodegaId;
    if (haciaBodegaId > 0) where.haciaBodegaId = haciaBodegaId;

    const accessWhere = await this.buildBodegaAccessWhere(user);
    if (Object.keys(accessWhere).length) {
      where.AND = [...(where.AND || []), accessWhere];
    }

    return this.prisma.solicitudTraslado.findMany({
      where,
      include: this.solicitudInclude,
      orderBy: { fecha: "desc" },
    });
  }

  /**
   * Toma la decision dentro de una sola transaccion. El updateMany funciona
   * como un cerrojo: solo la primera persona que encuentre la solicitud en
   * PENDIENTE_APROBACION puede continuar. Las demas reciben conflicto sin
   * mover inventario ni cambiar la decision ya tomada.
   */
  private async resolverAprobacionSolicitud(
    solicitud: any,
    estado: "PENDIENTE" | "CANCELADO",
    data: any,
    user?: { id?: number; usuario?: string; nombre?: string },
  ) {
    const aprobado = estado === "PENDIENTE";
    const estadoFinal = aprobado && solicitud.ventaId ? "RECIBIDO" : estado;
    const usuario = `${user?.usuario || user?.nombre || user?.id || ""}`.trim();

    const actualizada = await this.prisma.$transaction(
      async (tx) => {
        const tomada = await tx.solicitudTraslado.updateMany({
          where: { id: solicitud.id, estado: "PENDIENTE_APROBACION" },
          data: { estado: "RESOLVIENDO_APROBACION" },
        });
        if (tomada.count !== 1) {
          throw new ConflictException(
            "Esta solicitud ya fue respondida por otro usuario",
          );
        }

        await tx.detalleVenta.updateMany({
          where: { solicitudTrasladoId: solicitud.id },
          data: { trasladoEstado: estadoFinal },
        });

        if (aprobado && solicitud.ventaId) {
          await this.liquidarStockVentaEnTransaccion(tx, solicitud);
        }

        return tx.solicitudTraslado.update({
          where: { id: solicitud.id },
          data: {
            estado: estadoFinal,
            observaciones:
              data?.observaciones ?? solicitud.observaciones,
            ...(aprobado
              ? { aprobadoPor: usuario || null, aprobadoEn: new Date() }
              : {}),
          },
          include: this.solicitudInclude,
        });
      },
      { maxWait: 5000, timeout: 20000 },
    );

    try {
      await this.alertas.marcarAlertasSolicitudTrasladoLeidas([
        solicitud.id,
      ]);
    } catch (error) {
      // La solicitud ya quedo resuelta. Al listar alertas se vuelve a intentar
      // la limpieza, por lo que una falla de notificacion no revierte negocio.
      this.logger.error(
        `No se pudieron cerrar las alertas del traslado ${solicitud.id}`,
        (error as Error)?.message,
      );
    }

    if (solicitud.solicitanteId) {
      const resolutor = await this.nombreDe(Number(user?.id || 0), user);
      const comentario = `${data?.observaciones || ""}`.trim();
      await this.avisar({
        usuarioIds: [solicitud.solicitanteId],
        tipo: "solicitud_traslado_resuelta",
        titulo: aprobado
          ? "Solicitud de traslado aprobada"
          : "Solicitud de traslado rechazada",
        mensaje: aprobado
          ? `${resolutor} de ${solicitud.desdeBodega?.nombre || "la otra tienda"} aprobo tu solicitud de traslado.${comentario ? ` Comentario: ${comentario}` : ""}`
          : `${resolutor} de ${solicitud.desdeBodega?.nombre || "la otra tienda"} rechazo tu solicitud de traslado.${comentario ? ` Motivo: ${comentario}` : ""}`,
        payload: {
          solicitudTrasladoResueltaId: solicitud.id,
          prioridad: aprobado ? "normal" : "alta",
          aprobado,
          desdeBodega: solicitud.desdeBodega?.nombre || "",
          haciaBodega: solicitud.haciaBodega?.nombre || "",
          comentario,
        },
      });
    }

    return actualizada;
  }

  async actualizarSolicitudEstado(
    id: number,
    data: any,
    user?: { id?: number; rol?: string | null; permisos?: string[] | null },
  ) {
    const estado = `${data?.estado || ""}`.trim().toUpperCase();
    const estadosPermitidos = new Set(["PENDIENTE_APROBACION", "PENDIENTE", "PREPARADO", "EN_TRANSITO", "RECIBIDO_PARCIAL", "RECIBIDO", "CANCELADO"]);
    if (!estadosPermitidos.has(estado)) {
      throw new BadRequestException("Estado de solicitud invalido");
    }

    const solicitud = await this.prisma.solicitudTraslado.findUnique({
      where: { id },
      include: this.solicitudInclude,
    });
    if (!solicitud) throw new BadRequestException("Solicitud de traslado no encontrada");

    if (
      data?.resolverAutorizacion === true &&
      solicitud.estado !== "PENDIENTE_APROBACION"
    ) {
      throw new ConflictException(
        "Esta solicitud ya fue respondida por otro usuario",
      );
    }

    const resolviendoAprobacion =
      solicitud.estado === "PENDIENTE_APROBACION" && (estado === "PENDIENTE" || estado === "CANCELADO");

    /**
     * Cada paso lo da una tienda distinta, y antes no se validaba: bastaba con
     * tener acceso a las dos bodegas (un administrador lo tiene) para enviar y
     * recibir el mismo traslado uno mismo, con lo que el "acuse de recibo" no
     * acreditaba nada.
     *
     * Autorizar es de quien tiene el producto; enviar tambien; recibir es de
     * quien lo pidio. Cancelar puede cualquiera de las dos partes.
     */
    const currentAdmin = await this.isCurrentAdmin(user);
    if (!currentAdmin) {
      if (resolviendoAprobacion) {
        await assertBodegaAccess(this.prisma, user, solicitud.desdeBodegaId, "traslados");
      } else if (estado === "EN_TRANSITO" || estado === "PREPARADO") {
        await assertBodegaAccess(this.prisma, user, solicitud.desdeBodegaId, "traslados");
      } else if (estado === "RECIBIDO" || estado === "RECIBIDO_PARCIAL") {
        await assertBodegaAccess(this.prisma, user, solicitud.haciaBodegaId, "traslados");
      } else if (estado === "CANCELADO") {
        await this.assertAlgunaBodega(user, solicitud.desdeBodegaId, solicitud.haciaBodegaId);
      } else {
        await assertBodegaAccess(this.prisma, user, solicitud.desdeBodegaId, "traslados");
        await assertBodegaAccess(this.prisma, user, solicitud.haciaBodegaId, "traslados");
      }
    }

    if (resolviendoAprobacion) {
      return this.resolverAprobacionSolicitud(
        solicitud,
        estado as "PENDIENTE" | "CANCELADO",
        data,
        user,
      );
    }

    // Mientras espera autorizacion lo unico que puede pasarle a una solicitud es
    // que la tienda dueña del stock la apruebe (PENDIENTE) o la rechace
    // (CANCELADO). Sin esta guarda se podia saltar directo a RECIBIDO, que va a
    // recibirSolicitudParcial y mueve inventario, dejando la autorizacion sin
    // efecto.
    if (
      solicitud.estado === "PENDIENTE_APROBACION" &&
      !["PENDIENTE", "CANCELADO", "PENDIENTE_APROBACION"].includes(estado)
    ) {
      throw new BadRequestException(
        "La solicitud todavia espera la autorizacion de la tienda que tiene el producto",
      );
    }

    // El producto tiene que salir antes de poder llegar. Sin este orden, la
    // tienda destino podia dar por recibido algo que la otra nunca despacho.
    // Las solicitudes que vienen de una venta no aplican: ahi el stock ya se
    // liquido al autorizar y no hay envio fisico entre tiendas.
    if (estado === "RECIBIDO" && !solicitud.ventaId && solicitud.estado === "PENDIENTE") {
      throw new BadRequestException(
        `${solicitud.desdeBodega?.nombre || "La tienda origen"} todavia no marca el traslado como enviado`,
      );
    }

    if (solicitud.estado === "RECIBIDO" && estado === "RECIBIDO") {
      return solicitud;
    }

    if (estado === "RECIBIDO") {
      return this.recibirSolicitudParcial(id, {
        responsable: data?.responsable,
        observaciones: data?.observaciones,
        detalle: solicitud.detalle
          .map((item: any) => ({
            detalleId: item.id,
            cantidad: Math.max(0, Number(item.cantidad || 0) - Number(item.cantidadRecibida || 0)),
          }))
          .filter((item: any) => item.cantidad > 0),
      }, user);
    }

    if (estado === "CANCELADO") {
      await this.prisma.detalleVenta.updateMany({
        where: { solicitudTrasladoId: solicitud.id },
        data: { trasladoEstado: "CANCELADO" },
      });
    } else {
      await this.prisma.detalleVenta.updateMany({
        where: { solicitudTrasladoId: solicitud.id },
        data: { trasladoEstado: estado },
      });
    }

    // Una venta que jalo stock de otra tienda no descuenta nada hasta este
    // momento (ver ventas.service.ts): recien al aprobar se resta, porque el
    // producto ya salio por la venta y no hay bodega destino que lo reciba.
    // Despacho: la mercaderia sale del inventario de la tienda origen y queda
    // en la bodega puente. Antes no salia de ningun lado hasta que el destino
    // confirmaba, asi que mientras viajaba figuraba como si siguiera en la
    // tienda que ya la habia entregado.
    // Las solicitudes de venta no pasan por aqui: ese producto va al cliente.
    if (estado === "EN_TRANSITO" && !solicitud.ventaId && solicitud.estado !== "EN_TRANSITO") {
      const transito = await this.bodegaTransito();
      if (transito) {
        await this.moverStock(
          solicitud.desdeBodegaId,
          transito.id,
          (solicitud.detalle as any[]).map((item) => ({
            productoId: Number(item.productoId),
            cantidad: Number(item.cantidad || 0) - Number(item.cantidadRecibida || 0),
          })).filter((item) => item.cantidad > 0),
          `Despacho ${solicitud.folio || `solicitud #${solicitud.id}`}`,
        );
      }
    }

    const estadoFinal = estado;

    const actualizada = await this.prisma.solicitudTraslado.update({
      where: { id },
      data: {
        estado: estadoFinal,
        observaciones: data?.observaciones ?? solicitud.observaciones,
      },
      include: this.solicitudInclude,
    });

    return actualizada;
  }

  async recibirSolicitudParcial(
    id: number,
    data: any,
    user?: { id?: number; rol?: string | null; permisos?: string[] | null },
  ) {
    const solicitud = await this.prisma.solicitudTraslado.findUnique({
      where: { id },
      include: this.solicitudInclude,
    });
    if (!solicitud) throw new BadRequestException("Solicitud de traslado no encontrada");
    if (solicitud.estado === "CANCELADO") throw new BadRequestException("No se puede recibir una solicitud cancelada");
    if (solicitud.estado === "RECIBIDO") throw new BadRequestException("La solicitud ya fue recibida completamente");
    // Este endpoint tambien es alcanzable directamente, no solo via
    // actualizarSolicitudEstado: la guarda tiene que estar en los dos lados.
    if (solicitud.estado === "PENDIENTE_APROBACION") {
      throw new BadRequestException(
        "La solicitud todavia espera la autorizacion de la tienda que tiene el producto",
      );
    }
    await assertBodegaAccess(this.prisma, user, solicitud.desdeBodegaId, "traslados");
    await assertBodegaAccess(this.prisma, user, solicitud.haciaBodegaId, "traslados");

    const detalleInput = Array.isArray(data?.detalle) ? data.detalle : [];
    if (!detalleInput.length) throw new BadRequestException("Ingresa al menos una cantidad a recibir");

    const detalleMap = new Map((solicitud.detalle as any[]).map((item) => [Number(item.id), item]));
    const detalleRecibido: Array<{ detalleId: number; productoId: number; cantidad: number }> = [];
    for (const row of detalleInput) {
      const detalleId = Number(row.detalleId || row.id || 0);
      const cantidad = Number(row.cantidad || row.cantidadRecibida || 0);
      if (!detalleId || cantidad <= 0) continue;
      const detalle = detalleMap.get(detalleId);
      if (!detalle) throw new BadRequestException("Una linea no pertenece a la solicitud");
      const pendiente = Number(detalle.cantidad || 0) - Number(detalle.cantidadRecibida || 0);
      if (cantidad > pendiente) {
        throw new BadRequestException(
          `La cantidad recibida de producto ${detalle.productoId} supera lo pendiente (${pendiente})`,
        );
      }
      detalleRecibido.push({ detalleId, productoId: Number(detalle.productoId), cantidad });
    }
    if (!detalleRecibido.length) throw new BadRequestException("No hay cantidades pendientes para recibir");

    const folioResp = user?.id
      ? await this.correlativos.generarUsuarioOperacionCorrelativo(Number(user.id), "traslado")
      : null;
    const traslado = await this.prisma.traslado.create({
      data: {
        folio: folioResp?.correlativo || null,
        desdeBodegaId: solicitud.desdeBodegaId,
        haciaBodegaId: solicitud.haciaBodegaId,
        responsable: data?.responsable || solicitud.responsable,
        observaciones:
          data?.observaciones ||
          solicitud.observaciones ||
          `Recepcion parcial de ${solicitud.folio || `solicitud #${solicitud.id}`}`,
        solicitudTrasladoId: solicitud.id,
        estado: "RECIBIDO",
      },
    });

    for (const item of detalleRecibido) {
      await this.prisma.detalleTraslado.create({
        data: {
          trasladoId: traslado.id,
          productoId: item.productoId,
          cantidad: item.cantidad,
        },
      });
    }

    if (!solicitud.ventaId) {
      // Si la mercaderia ya fue despachada esta en la bodega puente, no en la
      // tienda origen: descargarla de ahi es lo que cierra el circulo y deja el
      // inventario cuadrado. Si no hay bodega de transito configurada, o el
      // traslado nunca se marco como enviado, sale directo del origen como
      // antes.
      // El estado no alcanza para saberlo. Una solicitud que quedo EN_TRANSITO
      // antes de que existiera la bodega puente tiene su mercaderia en la
      // tienda origen: en el flujo viejo nada se movia hasta la recepcion.
      // Deducirlo del estado la mandaba a descargar de transito, donde nunca
      // estuvo, y la recepcion moria con "stock insuficiente" dejando el
      // traslado trabado. Por eso se comprueba el rastro real del despacho.
      const transito = await this.bodegaTransito();
      const referenciaDespacho = `Despacho ${solicitud.folio || `solicitud #${solicitud.id}`}`;
      const yaDespachado = transito
        ? (await this.prisma.movInventario.count({
            where: { bodegaId: transito.id, tipo: "traslado_entrada", referencia: referenciaDespacho },
          })) > 0
        : false;
      const bodegaSalida = yaDespachado && transito ? transito.id : solicitud.desdeBodegaId;

      await this.moverStock(
        bodegaSalida,
        solicitud.haciaBodegaId,
        detalleRecibido.map((item) => ({ productoId: item.productoId, cantidad: item.cantidad })),
        traslado.folio || `Recepcion solicitud #${solicitud.id}`,
      );
    }

    for (const item of detalleRecibido) {
      const detalleOriginal = detalleMap.get(item.detalleId);
      const nuevaRecibida = Number(detalleOriginal.cantidadRecibida || 0) + item.cantidad;
      const estadoDetalle = nuevaRecibida >= Number(detalleOriginal.cantidad || 0) ? "RECIBIDO" : "PARCIAL";
      await this.prisma.detalleSolicitudTraslado.update({
        where: { id: item.detalleId },
        data: {
          cantidadRecibida: { increment: item.cantidad },
          estado: estadoDetalle,
        },
      });
    }

    const detalleActualizado = await this.prisma.detalleSolicitudTraslado.findMany({
      where: { solicitudId: solicitud.id },
    });
    const todoRecibido = detalleActualizado.every((item) => Number(item.cantidadRecibida || 0) >= Number(item.cantidad || 0));
    const algoRecibido = detalleActualizado.some((item) => Number(item.cantidadRecibida || 0) > 0);
    const estadoSolicitud = todoRecibido ? "RECIBIDO" : algoRecibido ? "RECIBIDO_PARCIAL" : solicitud.estado;

    await this.prisma.detalleVenta.updateMany({
      where: { solicitudTrasladoId: solicitud.id },
      data: { trasladoEstado: estadoSolicitud },
    });

    return this.prisma.solicitudTraslado.update({
      where: { id: solicitud.id },
      data: {
        estado: estadoSolicitud,
        ...(todoRecibido ? { recibidoEn: new Date() } : {}),
        observaciones: data?.observaciones ?? solicitud.observaciones,
      },
      include: this.solicitudInclude,
    });
  }
}
