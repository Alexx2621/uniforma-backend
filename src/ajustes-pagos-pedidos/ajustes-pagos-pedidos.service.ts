import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type AuthUser = { id?: number; rol?: string | null; permisos?: string[] | null };

@Injectable()
export class AjustesPagosPedidosService {
  constructor(private prisma: PrismaService) {}

  private roundMoney(value: unknown) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  private userId(user?: AuthUser) {
    const id = Number(user?.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw new ForbiddenException('No se pudo identificar al usuario');
    return id;
  }

  private canManage(user?: AuthUser) {
    return `${user?.rol || ''}`.trim().toUpperCase() === 'ADMIN'
      || Boolean(user?.permisos?.includes('correcciones.manage'));
  }

  private assertCanManage(user?: AuthUser) {
    if (!this.canManage(user)) throw new ForbiddenException('No tienes permiso para autorizar ajustes de pagos');
  }

  private normalizeMethod(value: unknown) {
    const method = `${value || ''}`.trim().toLowerCase().replace(/[\s.-]+/g, '_');
    const allowed = new Set(['efectivo', 'transferencia', 'deposito_bancario', 'tarjeta', 'visalink']);
    if (!allowed.has(method)) throw new BadRequestException('Selecciona un método de pago válido');
    return method;
  }

  private requiresReference(method: string) {
    return ['transferencia', 'deposito_bancario', 'tarjeta', 'visalink'].includes(method);
  }

  private parseRealPaymentDate(value: unknown) {
    const text = `${value || ''}`.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new BadRequestException('Selecciona la fecha real del pago');
    const date = new Date(`${text}T12:00:00-06:00`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('La fecha real del pago no es válida');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    if (text > today) throw new BadRequestException('La fecha real del pago no puede estar en el futuro');
    return { date, dateOnly: text };
  }

  async listar(user: AuthUser, query: { estado?: string; q?: string } = {}) {
    const usuarioId = this.userId(user);
    const estado = `${query.estado || ''}`.trim().toLowerCase();
    const q = `${query.q || ''}`.trim();
    const rows = await this.prisma.ajustePagoPedido.findMany({
      where: {
        ...(this.canManage(user) ? {} : { solicitadoPorId: usuarioId }),
        ...(estado && estado !== 'todos'
          ? estado === 'pendiente'
            ? { estado: { in: ['pendiente', 'pendiente_segunda_aprobacion'] } }
            : { estado }
          : {}),
        ...(q ? {
          OR: [
            { folio: { contains: q } },
            { pedido: { folio: { contains: q } } },
            { pedido: { clienteNombre: { contains: q } } },
          ],
        } : {}),
      },
      include: {
        pedido: { select: { id: true, folio: true, clienteNombre: true, totalEstimado: true, saldoPendiente: true, estado: true } },
        pagoOriginal: { select: { id: true, monto: true, metodo: true, fecha: true, tipo: true } },
        solicitadoPor: { select: { id: true, nombre: true, usuario: true } },
        aprobadoPor: { select: { id: true, nombre: true, usuario: true } },
        segundaAprobacionPor: { select: { id: true, nombre: true, usuario: true } },
      },
      orderBy: { creadoEn: 'desc' },
      take: 500,
    });
    return rows;
  }

  async crear(user: AuthUser, body: any) {
    const solicitadoPorId = this.userId(user);
    const requestId = `${body?.requestId || ''}`.trim();
    if (!requestId || requestId.length > 100) throw new BadRequestException('Identificador de solicitud inválido');

    const existing = await this.prisma.ajustePagoPedido.findUnique({ where: { requestId } });
    if (existing) return existing;

    const pedidoId = Number(body?.pedidoId || 0);
    const pagoOriginalId = Number(body?.pagoOriginalId || 0);
    if (!Number.isInteger(pedidoId) || pedidoId <= 0 || !Number.isInteger(pagoOriginalId) || pagoOriginalId <= 0) {
      throw new BadRequestException('Selecciona un pedido y un pago válidos');
    }

    const pago = await this.prisma.pagoPedido.findUnique({
      where: { id: pagoOriginalId },
      include: { pedido: { include: { pagos: true } } },
    });
    if (!pago || pago.pedidoId !== pedidoId) throw new NotFoundException('El pago seleccionado no pertenece al pedido');
    if (`${pago.tipo || ''}`.trim().toLowerCase().startsWith('ajuste_')) {
      throw new BadRequestException('No se puede crear un ajuste sobre otro ajuste; selecciona el pago original');
    }
    if (`${pago.pedido.estado || ''}`.trim().toLowerCase() === 'anulado') {
      throw new BadRequestException('No se puede ajustar un pedido anulado');
    }
    if (!this.canManage(user) && Number(pago.pedido.usuarioId || 0) !== solicitadoPorId) {
      throw new ForbiddenException('Solo puedes solicitar ajustes de tus propios pedidos');
    }

    const pending = await this.prisma.ajustePagoPedido.findFirst({
      where: { pagoOriginalId, estado: { in: ['pendiente', 'pendiente_segunda_aprobacion'] } },
    });
    if (pending) throw new BadRequestException(`Ya existe una solicitud pendiente para este pago: ${pending.folio}`);

    const montoRegistrado = this.roundMoney(pago.monto);
    const montoCorrecto = this.roundMoney(body?.montoCorrecto);
    const diferencia = this.roundMoney(montoCorrecto - montoRegistrado);
    if (montoCorrecto < 0) throw new BadRequestException('El monto correcto no puede ser negativo');
    if (Math.abs(diferencia) < 0.01) throw new BadRequestException('El monto correcto debe ser diferente al registrado');

    const pagadoActual = this.roundMoney(pago.pedido.pagos.reduce(
      (sum, item) => sum + Number(item.monto || 0) + Number(item.recargo || 0), 0,
    ));
    const pagadoAjustado = this.roundMoney(pagadoActual + diferencia);
    if (pagadoAjustado < 0 || pagadoAjustado - Number(pago.pedido.totalEstimado || 0) > 0.005) {
      throw new BadRequestException('El ajuste dejaría el total pagado fuera del rango permitido para el pedido');
    }

    const method = this.normalizeMethod(body?.metodo || pago.metodo);
    const referencia = `${body?.referencia || ''}`.trim();
    const banco = `${body?.banco || ''}`.trim();
    const motivo = `${body?.motivo || ''}`.trim();
    const evidenciaReferencia = `${body?.evidenciaReferencia || ''}`.trim();
    if (this.requiresReference(method) && !referencia) throw new BadRequestException('La referencia del pago es obligatoria');
    if (method === 'deposito_bancario' && !banco) throw new BadRequestException('El banco es obligatorio para depósitos');
    if (motivo.length < 15) throw new BadRequestException('Describe el motivo del ajuste con al menos 15 caracteres');
    if (evidenciaReferencia.length < 5) throw new BadRequestException('Indica el comprobante o evidencia que respalda el ajuste');
    const { date: fechaPagoReal } = this.parseRealPaymentDate(body?.fechaPagoReal);

    const suffix = requestId.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase() || `${Date.now()}`.slice(-8);
    return this.prisma.ajustePagoPedido.create({
      data: {
        folio: `AJ-P-${new Date().getFullYear()}-${suffix}`,
        requestId,
        pedidoId,
        pagoOriginalId,
        montoRegistrado,
        montoCorrecto,
        diferencia,
        fechaPagoReal,
        metodo: method,
        referencia: referencia || null,
        banco: method === 'deposito_bancario' ? banco : null,
        ubicacion: `${body?.ubicacion || pago.ubicacion || pago.pedido.ubicacion || ''}`.trim() || null,
        motivo,
        evidenciaReferencia,
        aprobacionesRequeridas: Math.abs(diferencia) >= 5_000 ? 2 : 1,
        solicitadoPorId,
      },
      include: { pedido: true, pagoOriginal: true },
    });
  }

  async aprobar(id: number, user: AuthUser, body: any) {
    const aprobadorId = this.userId(user);
    this.assertCanManage(user);
    const comentario = `${body?.comentario || ''}`.trim();
    const current = await this.prisma.ajustePagoPedido.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Solicitud de ajuste no encontrada');
    if (current.solicitadoPorId === aprobadorId) throw new ForbiddenException('Quien solicita el ajuste no puede autorizarlo');
    if (!['pendiente', 'pendiente_segunda_aprobacion'].includes(current.estado)) {
      throw new BadRequestException('La solicitud ya fue resuelta');
    }

    if (current.aprobacionesRequeridas > 1 && !current.aprobadoPorId) {
      const claimed = await this.prisma.ajustePagoPedido.updateMany({
        where: { id, estado: 'pendiente', aprobadoPorId: null },
        data: {
          estado: 'pendiente_segunda_aprobacion',
          aprobadoPorId: aprobadorId,
          aprobadoEn: new Date(),
          respuesta: comentario || 'Primera aprobación registrada',
        },
      });
      if (claimed.count !== 1) throw new BadRequestException('La solicitud fue aprobada simultaneamente; actualiza la bandeja');
      return this.prisma.ajustePagoPedido.findUnique({ where: { id } });
    }
    if (current.aprobadoPorId === aprobadorId) {
      throw new ForbiddenException('La segunda aprobación debe realizarla otro administrador');
    }

    return this.aplicar(id, aprobadorId, comentario);
  }

  async rechazar(id: number, user: AuthUser, body: any) {
    const userId = this.userId(user);
    this.assertCanManage(user);
    const respuesta = `${body?.comentario || ''}`.trim();
    if (respuesta.length < 8) throw new BadRequestException('Indica el motivo del rechazo');
    const current = await this.prisma.ajustePagoPedido.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Solicitud de ajuste no encontrada');
    if (!['pendiente', 'pendiente_segunda_aprobacion'].includes(current.estado)) {
      throw new BadRequestException('La solicitud ya fue resuelta');
    }
    if (current.solicitadoPorId === userId) throw new ForbiddenException('Quien solicita el ajuste no puede rechazarlo');
    return this.prisma.ajustePagoPedido.update({
      where: { id },
      data: { estado: 'rechazado', respuesta, aprobadoPorId: current.aprobadoPorId || userId, aprobadoEn: new Date() },
    });
  }

  private async aplicar(id: number, aprobadorId: number, comentario: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.ajustePagoPedido.updateMany({
        where: { id, estado: { in: ['pendiente', 'pendiente_segunda_aprobacion'] } },
        data: { estado: 'aplicando' },
      });
      if (claimed.count !== 1) throw new BadRequestException('La solicitud ya no esta disponible para aplicar');
      const ajuste = await tx.ajustePagoPedido.findUnique({
        where: { id },
        include: { pagoOriginal: true, pedido: { include: { pagos: true } } },
      });
      if (!ajuste) {
        throw new BadRequestException('La solicitud ya no está disponible para aplicar');
      }
      if (`${ajuste.pedido.estado || ''}`.trim().toLowerCase() === 'anulado') {
        throw new BadRequestException('El pedido fue anulado y ya no admite ajustes');
      }

      const pagadoActual = this.roundMoney(ajuste.pedido.pagos.reduce(
        (sum, item) => sum + Number(item.monto || 0) + Number(item.recargo || 0), 0,
      ));
      const totalAjustado = this.roundMoney(pagadoActual + ajuste.diferencia);
      const totalPedido = this.roundMoney(ajuste.pedido.totalEstimado);
      if (totalAjustado < 0 || totalAjustado - totalPedido > 0.005) {
        throw new BadRequestException('El pedido cambió y el ajuste ya no produce un saldo válido');
      }

      const pagoGenerado = await tx.pagoPedido.create({
        data: {
          pedidoId: ajuste.pedidoId,
          monto: ajuste.diferencia,
          metodo: ajuste.metodo,
          tipo: `${ajuste.pagoOriginal.tipo || ''}`.toLowerCase() === 'anticipo' ? 'ajuste_anticipo' : 'ajuste_saldo',
          fecha: ajuste.fechaPagoReal,
          referencia: ajuste.referencia,
          banco: ajuste.banco,
          ubicacion: ajuste.ubicacion,
          referenciaDocumento: ajuste.folio,
          observacionesPago: `Ajuste autorizado: ${ajuste.motivo}`,
        },
      });

      const pagosFinales = [...ajuste.pedido.pagos, pagoGenerado];
      const anticipo = this.roundMoney(pagosFinales
        .filter((item) => ['anticipo', 'ajuste_anticipo'].includes(`${item.tipo || ''}`.toLowerCase()))
        .reduce((sum, item) => sum + Number(item.monto || 0) + Number(item.recargo || 0), 0));
      const saldoPendiente = this.roundMoney(Math.max(0, totalPedido - totalAjustado));
      await tx.pedidoProduccion.update({
        where: { id: ajuste.pedidoId },
        data: {
          anticipo,
          saldoPendiente,
          estado: saldoPendiente <= 0
            ? 'recibido'
            : ['recibido', 'completado'].includes(`${ajuste.pedido.estado || ''}`.toLowerCase())
              ? 'pendiente_pago'
              : ajuste.pedido.estado,
        },
      });

      const cierres = await this.rectificarCierre(tx, ajuste, pagoGenerado.id, aprobadorId);
      await tx.correccionControlada.create({
        data: {
          modulo: 'Ajustes de pagos cerrados',
          entidadTipo: 'ajustePagoPedido',
          entidadId: ajuste.id,
          correlativo: ajuste.folio,
          titulo: `${ajuste.pedido.folio || `Pedido ${ajuste.pedidoId}`} - ajuste de pago`,
          campo: 'monto',
          etiqueta: 'Ajuste posterior al cierre',
          valorAnterior: ajuste.montoRegistrado,
          valorNuevo: ajuste.montoCorrecto,
          motivo: ajuste.motivo,
          dataAnterior: { pagoId: ajuste.pagoOriginalId, monto: ajuste.montoRegistrado } as Prisma.InputJsonValue,
          dataNueva: { pagoGeneradoId: pagoGenerado.id, diferencia: ajuste.diferencia, saldoPendiente } as Prisma.InputJsonValue,
          usuarioId: aprobadorId,
        },
      });

      return tx.ajustePagoPedido.update({
        where: { id },
        data: {
          estado: 'aplicado',
          pagoGeneradoId: pagoGenerado.id,
          cierreOriginalId: cierres.originalId,
          cierreRectificadoId: cierres.rectificadoId,
          aprobadoPorId: ajuste.aprobadoPorId || aprobadorId,
          segundaAprobacionPorId: ajuste.aprobadoPorId ? aprobadorId : null,
          respuesta: comentario || 'Ajuste autorizado y aplicado',
          aprobadoEn: ajuste.aprobadoEn || new Date(),
          segundaAprobacionEn: ajuste.aprobadoPorId ? new Date() : null,
          aplicadoEn: new Date(),
        },
        include: { pedido: true, pagoOriginal: true, pagoGenerado: true },
      });
    });
  }

  private async rectificarCierre(tx: any, ajuste: any, pagoGeneradoId: number, aprobadorId: number) {
    const fecha = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(ajuste.fechaPagoReal));
    const usuarioId = Number(ajuste.pedido.usuarioId || ajuste.solicitadoPorId);
    const documentos = await tx.documentoGenerado.findMany({
      where: { tipo: 'reporteDiario', usuarioId },
      orderBy: { creadoEn: 'desc' },
    });
    const matching = documentos.filter((doc: any) => `${doc?.data?.fecha || ''}` === fecha);
    if (!matching.length) return { originalId: null, rectificadoId: null };

    const source = matching[0];
    const sourceData = JSON.parse(JSON.stringify(source.data || {}));
    const rootId = Number(sourceData.rectificacionRaizId || source.id);
    const root = matching.find((doc: any) => doc.id === rootId) || source;
    const version = Math.max(1, ...matching.map((doc: any) => Number(doc?.data?.versionRectificacion || 1))) + 1;
    const baseCorrelativo = `${root.correlativo}`.replace(/-R\d+$/, '');
    const correlativo = `${baseCorrelativo}-R${version}`;
    const ajustes = Array.isArray(sourceData.ajustesPosteriores) ? sourceData.ajustesPosteriores : [];
    const adjustmentRow = {
      id: ajuste.id,
      folio: ajuste.folio,
      pedidoId: ajuste.pedidoId,
      pedidoFolio: ajuste.pedido.folio || `P-${ajuste.pedidoId}`,
      pagoOriginalId: ajuste.pagoOriginalId,
      pagoGeneradoId,
      fechaPagoReal: fecha,
      fechaAjuste: new Date().toISOString(),
      metodo: ajuste.metodo,
      referencia: ajuste.referencia || '',
      monto: ajuste.diferencia,
      motivo: ajuste.motivo,
      evidenciaReferencia: ajuste.evidenciaReferencia,
      autorizadoPorId: aprobadorId,
    };
    const newData = {
      ...sourceData,
      estadoRectificacion: 'vigente',
      esRectificacion: true,
      versionRectificacion: version,
      rectificacionRaizId: rootId,
      rectificacionDeId: source.id,
      ajustesPosteriores: [...ajustes, adjustmentRow],
      motivoRectificacion: `Ajuste ${ajuste.folio}: ${ajuste.motivo}`,
    };
    const rectificado = await tx.documentoGenerado.create({
      data: {
        tipo: 'reporteDiario',
        correlativo,
        titulo: `Rectificación v${version} - ${source.titulo || `Reporte diario ${fecha}`}`,
        data: newData,
        usuarioId,
      },
    });
    const quincenales = await tx.documentoGenerado.findMany({ where: { tipo: 'reporteQuincenal', usuarioId } });
    for (const doc of quincenales) {
      const data = JSON.parse(JSON.stringify(doc.data || {}));
      const desde = `${data.desde || data.fechaDesde || ''}`.slice(0, 10);
      const hasta = `${data.hasta || data.fechaHasta || ''}`.slice(0, 10);
      if ((desde && fecha < desde) || (hasta && fecha > hasta)) continue;
      await tx.documentoGenerado.update({
        where: { id: doc.id },
        data: {
          data: {
            ...data,
            requiereRevisionPorAjuste: true,
            ajustesPendientesRevision: [...(Array.isArray(data.ajustesPendientesRevision) ? data.ajustesPendientesRevision : []), ajuste.folio],
          } as Prisma.InputJsonValue,
        },
      });
    }
    return { originalId: source.id, rectificadoId: rectificado.id };
  }
}
