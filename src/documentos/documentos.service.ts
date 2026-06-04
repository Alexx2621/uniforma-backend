import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CorrelativosService } from '../correlativos/correlativos.service';
import { ReportesService } from '../reportes/reportes.service';
import { NotificacionesConfigService } from '../config/notificaciones.service';

const DOCUMENTO_OPERACION: Record<string, string> = {
  cotizacion: 'cotizacion',
  reporteDiario: 'reporteDiario',
  reporteQuincenal: 'reporteQuincenal',
  reporteMensual: 'reporteMensual',
};

@Injectable()
export class DocumentosService {
  constructor(
    private prisma: PrismaService,
    private correlativos: CorrelativosService,
    private reportesService: ReportesService,
    private configService: NotificacionesConfigService,
  ) {}

  private normalizeTipo(tipo?: string) {
    const value = `${tipo || ''}`.trim();
    if (!DOCUMENTO_OPERACION[value]) {
      throw new BadRequestException('Tipo de documento no soportado');
    }
    return value;
  }

  private ensureUsuario(usuarioId: number) {
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      throw new BadRequestException('No se pudo identificar el usuario');
    }
  }

  private async buildDocumentoWhere(
    authUser?: { id?: number; rol?: string; permisos?: string[] },
    tipo?: string,
    usuarioId?: number,
  ) {
    const currentUserId = Number(authUser?.id);
    this.ensureUsuario(currentUserId);

    const where: any = {};
    if (tipo) {
      where.tipo = this.normalizeTipo(tipo);
    }

    const currentUser = await this.prisma.usuario.findUnique({
      where: { id: currentUserId },
      select: {
        rolId: true,
        bodegaId: true,
        rol: { select: { nombre: true, permisos: { include: { permiso: true } } } },
      },
    });

    if (!currentUser) {
      throw new BadRequestException('No se pudo identificar el usuario');
    }

    const config = await this.configService.getConfig();
    const isAdmin =
      `${authUser?.rol || currentUser.rol?.nombre || ''}`.trim().toUpperCase() === 'ADMIN';
    const permisos =
      authUser?.permisos ||
      currentUser.rol?.permisos?.map((item) => item.permiso.nombre) ||
      [];
    const canUseDropdown =
      isAdmin ||
      permisos.includes('sistema.selector-vendedores') ||
      permisos.includes('dashboard.filtro-vendedor') ||
      permisos.includes('dashboard.ver-todo') ||
      config.vendedorDropdownRoleIds.includes(Number(currentUser.rolId));

    if (usuarioId !== undefined) {
      if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
        throw new BadRequestException('Usuario no valido');
      }
    }

    if (!canUseDropdown) {
      where.usuarioId = currentUserId;
      return where;
    }

    if (usuarioId !== undefined) {
      where.usuarioId = usuarioId;
    }

    if (!isAdmin && config.vendedorDropdownBodegaIds.length) {
      where.usuario = {
        bodegaId: { in: config.vendedorDropdownBodegaIds },
      };
    }

    return where;
  }

  private normalizeText(value?: string | null) {
    return `${value || ''}`
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  private documentoPerteneceAUsuario(documento: any, usuario: any, usuarioId: number) {
    if (Number(documento?.usuarioId) === Number(usuarioId)) return true;
    const data = documento?.data || {};
    const documentoValues = [
      data.vendedor,
      data.generadoPor,
      data.usuario,
      data.usuarioNombre,
      data.vendedorNombre,
    ]
      .map((value) => this.normalizeText(value))
      .filter(Boolean);
    if (!documentoValues.length) return false;

    const usuarioValues = [
      usuario?.nombre,
      usuario?.usuario,
      usuario?.usuarioCorrelativo,
      [usuario?.primerNombre, usuario?.primerApellido].filter(Boolean).join(' '),
    ]
      .map((value) => this.normalizeText(value))
      .filter(Boolean);

    return usuarioValues.some((userValue) =>
      documentoValues.some((docValue) => docValue === userValue || docValue.includes(userValue) || userValue.includes(docValue)),
    );
  }

  private getDocumentoFechaReporte(documento: any) {
    return `${documento?.data?.fecha || documento?.creadoEn || ''}`.slice(0, 10);
  }

  private getDocumentoVendedor(documento: any) {
    const data = documento?.data || {};
    return (
      documento?.usuario?.nombre ||
      documento?.usuario?.usuario ||
      data.vendedorNombre ||
      data.usuarioNombre ||
      data.vendedor ||
      data.usuario ||
      data.generadoPor ||
      'N/D'
    );
  }

  private getDocumentoTienda(documento: any) {
    const data = documento?.data || {};
    return data.tienda || data.bodegaNombre || data.bodega || 'N/D';
  }

  async listarTopCierresDiaAnterior(fecha?: string) {
    const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(`${fecha || ''}`)
      ? `${fecha}`
      : (() => {
          const date = new Date();
          date.setDate(date.getDate() - 1);
          date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
          return date.toISOString().slice(0, 10);
        })();

    const documentos = await this.prisma.documentoGenerado.findMany({
      where: { tipo: 'reporteDiario' },
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            usuario: true,
            usuarioCorrelativo: true,
            bodegaId: true,
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
    });

    return documentos
      .filter((documento) => this.getDocumentoFechaReporte(documento) === targetDate)
      .map((documento) => ({
        id: documento.id,
        correlativo: documento.correlativo,
        vendedor: this.getDocumentoVendedor(documento),
        tienda: this.getDocumentoTienda(documento),
        fecha: this.getDocumentoFechaReporte(documento),
        total: this.getReporteDiarioTotal(documento.data || {}),
      }))
      .sort((a, b) => Number(b.total || 0) - Number(a.total || 0))
      .slice(0, 3);
  }

  async listar(authUser?: { id?: number; rol?: string }, tipo?: string, usuarioId?: number) {
    if (usuarioId === undefined && ['reporteQuincenal', 'reporteMensual'].includes(`${tipo || ''}`.trim())) {
      this.ensureUsuario(Number(authUser?.id));
      return this.prisma.documentoGenerado.findMany({
        where: { tipo: this.normalizeTipo(tipo) },
        include: {
          usuario: {
            select: {
              id: true,
              nombre: true,
              usuario: true,
              usuarioCorrelativo: true,
              bodegaId: true,
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
      });
    }

    if (usuarioId !== undefined && ['reporteDiario', 'reporteQuincenal', 'reporteMensual'].includes(`${tipo || ''}`.trim())) {
      const where = await this.buildDocumentoWhere(authUser, tipo);
      const [documentos, usuarioFiltro] = await Promise.all([
        this.prisma.documentoGenerado.findMany({
          where,
          include: {
            usuario: {
              select: {
                id: true,
                nombre: true,
                usuario: true,
                usuarioCorrelativo: true,
                bodegaId: true,
              },
            },
          },
          orderBy: { creadoEn: 'desc' },
        }),
        this.prisma.usuario.findUnique({
          where: { id: usuarioId },
          select: {
            id: true,
            nombre: true,
            usuario: true,
            usuarioCorrelativo: true,
            primerNombre: true,
            primerApellido: true,
          },
        }),
      ]);
      if (!usuarioFiltro) return [];
      return documentos.filter((documento) => this.documentoPerteneceAUsuario(documento, usuarioFiltro, usuarioId));
    }

    const where = await this.buildDocumentoWhere(authUser, tipo, usuarioId);
    return this.prisma.documentoGenerado.findMany({
      where,
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            usuario: true,
            usuarioCorrelativo: true,
            bodegaId: true,
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async obtener(id: number, authUser?: { id?: number; rol?: string }) {
    const scope = authUser ? await this.buildDocumentoWhere(authUser) : {};
    const documento = await this.prisma.documentoGenerado.findFirst({
      where: { id, ...scope },
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            usuario: true,
            usuarioCorrelativo: true,
            bodegaId: true,
          },
        },
      },
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    return documento;
  }

  private async obtenerReporteQuincenal(id: number) {
    const documento = await this.prisma.documentoGenerado.findFirst({
      where: { id, tipo: 'reporteQuincenal' },
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            usuario: true,
            usuarioCorrelativo: true,
            bodegaId: true,
          },
        },
      },
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    return documento;
  }

  private async resolveDocumentoUsuarioId(
    authUser: { id?: number; rol?: string; permisos?: string[] } | undefined,
    requestedUsuarioId?: number,
  ) {
    const authUsuarioId = Number(authUser?.id);
    this.ensureUsuario(authUsuarioId);

    const targetUsuarioId = Number(requestedUsuarioId || authUsuarioId);
    this.ensureUsuario(targetUsuarioId);

    const isAdmin = `${authUser?.rol || ''}`.trim().toUpperCase() === 'ADMIN';
    const canGenerateForOtherUser =
      isAdmin || (Array.isArray(authUser?.permisos) && authUser.permisos.includes('reportes.reporte-diario.generar-ajeno'));
    if (!canGenerateForOtherUser && targetUsuarioId !== authUsuarioId) {
      throw new BadRequestException('Solo administradores pueden generar documentos para otro usuario');
    }

    if (targetUsuarioId !== authUsuarioId) {
      const usuario = await this.prisma.usuario.findUnique({
        where: { id: targetUsuarioId },
        select: { id: true, activo: true },
      });
      if (!usuario || !usuario.activo) {
        throw new BadRequestException('El vendedor seleccionado no existe o esta inactivo');
      }
    }

    return targetUsuarioId;
  }

  private shouldSkipReportEmail(body: { omitirCorreo?: boolean; data?: unknown }) {
    const data = body.data as any;
    return Boolean(body.omitirCorreo || data?.omitirCorreoReporte);
  }

  async crear(
    authUser: { id?: number; rol?: string; permisos?: string[] } | undefined,
    body: { tipo?: string; titulo?: string; data?: unknown; usuarioId?: number; omitirCorreo?: boolean },
  ) {
    const tipo = this.normalizeTipo(body.tipo);
    const usuarioId = await this.resolveDocumentoUsuarioId(authUser, Number(body.usuarioId || 0) || undefined);
    const correlativoResp = await this.correlativos.generarUsuarioOperacionCorrelativo(
      usuarioId,
      DOCUMENTO_OPERACION[tipo],
    );

    const documento = await this.prisma.documentoGenerado.create({
      data: {
        tipo,
        correlativo: correlativoResp.correlativo,
        titulo: `${body.titulo || ''}`.trim() || null,
        data: (body.data ?? {}) as object,
        usuarioId,
      },
    });

    if (tipo === 'reporteDiario' && !this.shouldSkipReportEmail(body)) {
      await this.checkAndSendDailyReportEmail(documento);
    }
    if (tipo === 'reporteQuincenal' && !this.shouldSkipReportEmail(body)) {
      await this.checkAndSendFortnightlyReportEmail(documento);
    }

    return documento;
  }

  async actualizar(
    id: number,
    body: { titulo?: string; data?: unknown; omitirCorreo?: boolean },
    authUser?: { id?: number; rol?: string },
  ) {
    await this.obtener(id, authUser);
    const documento = await this.prisma.documentoGenerado.update({
      where: { id },
      data: {
        titulo: body.titulo !== undefined ? `${body.titulo || ''}`.trim() || null : undefined,
        data: body.data !== undefined ? (body.data ?? {}) as object : undefined,
      },
    });

    if (documento.tipo === 'reporteDiario' && !this.shouldSkipReportEmail(body)) {
      await this.checkAndSendDailyReportEmail(documento);
    }
    if (documento.tipo === 'reporteQuincenal' && !this.shouldSkipReportEmail(body)) {
      await this.checkAndSendFortnightlyReportEmail(documento);
    }

    return documento;
  }

  async eliminar(id: number, authUser?: { id?: number; rol?: string }) {
    await this.obtener(id, authUser);
    return this.prisma.documentoGenerado.delete({ where: { id } });
  }

  async generarPdf(id: number, authUser?: { id?: number; rol?: string }) {
    const documento =
      (await this.prisma.documentoGenerado.findUnique({
        where: { id },
        select: { tipo: true },
      }))?.tipo === 'reporteQuincenal'
        ? await this.obtenerReporteQuincenal(id)
        : await this.obtener(id, authUser);
    if (!['reporteDiario', 'reporteQuincenal', 'reporteMensual'].includes(documento.tipo)) {
      throw new BadRequestException('El documento no soporta exportacion PDF');
    }

    const data = documento.data as any;
    if (documento.tipo === 'reporteMensual') {
      const monthlyData = await this.hydrateReporteMensualData(documento);
      const pdf = await this.reportesService.generarReporteMensualPdf({
        ...monthlyData,
        reporteNo: documento.correlativo,
      });

      return {
        filename: `reporte-mensual-${documento.correlativo}.pdf`,
        pdf,
      };
    }

    if (documento.tipo === 'reporteQuincenal') {
      const pdf = await this.reportesService.generarReporteQuincenalPdf({
        ...data,
        reporteNo: documento.correlativo,
      });

      return {
        filename: `reporte-quincenal-${documento.correlativo}.pdf`,
        pdf,
      };
    }

    const fecha = data?.fecha;
    if (!fecha) {
      throw new BadRequestException('El reporte diario no tiene fecha');
    }

    const pdf = await this.reportesService.generarReporteDiarioPdf(fecha, {
      ...data,
      liquidacionNo: documento.correlativo,
    });

    return {
      filename: `reporte-diario-${fecha}.pdf`,
      pdf,
    };
  }

  async generarReporteMensualConsolidadoPdf(
    ids: number[],
    authUser?: { id?: number; rol?: string; permisos?: string[] },
  ) {
    const uniqueIds = Array.from(new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));
    if (!uniqueIds.length) {
      throw new BadRequestException('Selecciona al menos un reporte mensual');
    }

    const scope = await this.buildDocumentoWhere(authUser, 'reporteMensual');
    const documentos = await this.prisma.documentoGenerado.findMany({
      where: {
        ...scope,
        tipo: 'reporteMensual',
        id: { in: uniqueIds },
      },
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            usuario: true,
            usuarioCorrelativo: true,
            bodegaId: true,
          },
        },
      },
      orderBy: { creadoEn: 'asc' },
    });

    if (documentos.length !== uniqueIds.length) {
      throw new BadRequestException('Uno o mas reportes seleccionados no existen o no tienes permiso para consultarlos');
    }

    const documentosConDatos = await Promise.all(
      documentos.map(async (documento) => ({
        ...documento,
        data: await this.hydrateReporteMensualData(documento),
      })),
    );

    const pdf = await this.reportesService.generarReporteMensualConsolidadoPdf(documentosConDatos);
    return {
      filename: `reporte-mensual-consolidado-${new Date().toISOString().slice(0, 10)}.pdf`,
      pdf,
    };
  }

  private async hydrateReporteMensualData(documento: any) {
    const data = documento?.data || {};
    const month = Number(data?.month || 0);
    const year = Number(data?.year || 0);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year <= 0) {
      return data;
    }

    const existingVentas = data?.ventasPorDia && typeof data.ventasPorDia === 'object' ? data.ventasPorDia : {};
    const existingTotal = Object.values(existingVentas).reduce<number>((sum: number, value: any) => sum + Number(value || 0), 0);
    const targetVendedor = this.normalizeText(data?.vendedor || data?.generadoPor || this.getDocumentoVendedor(documento));
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;

    const reportesDiarios = await this.prisma.documentoGenerado.findMany({
      where: { tipo: 'reporteDiario' },
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            usuario: true,
            usuarioCorrelativo: true,
            primerNombre: true,
            primerApellido: true,
            bodegaId: true,
          },
        },
      },
      orderBy: { creadoEn: 'asc' },
    });

    const ventasEncontradas: Record<number, number> = {};
    for (const diario of reportesDiarios) {
      const fecha = `${(diario.data as any)?.fecha || ''}`.slice(0, 10);
      if (!fecha.startsWith(monthPrefix)) continue;

      const mismoUsuario = Number(documento?.usuarioId || 0) > 0 && Number(diario.usuarioId) === Number(documento.usuarioId);
      const vendedorDiario = this.normalizeText(this.getDocumentoVendedor(diario));
      const vendedorCoincide =
        targetVendedor &&
        vendedorDiario &&
        (targetVendedor === vendedorDiario ||
          targetVendedor.includes(vendedorDiario) ||
          vendedorDiario.includes(targetVendedor));
      if (!mismoUsuario && !vendedorCoincide) continue;

      const day = Number(fecha.slice(8, 10));
      if (!Number.isInteger(day) || day <= 0) continue;
      ventasEncontradas[day] = Number(ventasEncontradas[day] || 0) + this.getReporteDiarioTotal(diario.data || {});
    }

    const foundTotal = Object.values(ventasEncontradas).reduce<number>((sum, value) => sum + Number(value || 0), 0);
    if (foundTotal <= 0 && existingTotal > 0) return data;
    if (foundTotal <= 0) return data;

    return {
      ...data,
      ventasPorDia: ventasEncontradas,
    };
  }

  private async checkAndSendDailyReportEmail(documento: any) {
    const data = documento.data as any;
    const fecha = data.fecha;
    if (!fecha) return;

    // Calcular total de ventas de todas las bodegas para esa fecha
    const total = this.getReporteDiarioTotal(data);

    // Enviar correo cuando se crea el reporte diario, usando la configuración definida
    await this.reportesService.sendDailyReportEmail(fecha, total, {
      ...data,
      liquidacionNo: documento.correlativo,
    });
  }

  private async checkAndSendFortnightlyReportEmail(documento: any) {
    const data = documento.data as any;
    const total = this.getReporteQuincenalTotal(data);

    await this.reportesService.sendFortnightlyReportEmail(total, {
      ...data,
      reporteNo: documento.correlativo,
    });
  }

  private getReporteDiarioTotal(data: any) {
    const capitalRows = this.asArray(data?.capitalRows);
    const departamentoRows = this.asArray(data?.departamentoRows);
    const tiendaAutoRows = this.asArray(data?.tiendaAutoRows);
    const ventasSnapshot = this.asArray(data?.ventasSnapshot);
    const pedidosSnapshot = this.asArray(data?.pedidosSnapshot);
    const tiendaManualRows = this.asArray(data?.tiendaManualRows);
    const capital = capitalRows.reduce(
      (sum, row) =>
        sum +
        Number(row?.transferencia || 0) +
        Number(row?.deposito || 0) +
        Number(row?.efectivo || 0),
      0,
    );
    const departamento = departamentoRows.reduce(
      (sum, row) =>
        sum + Number(row?.transferencia || 0) + Number(row?.deposito || 0),
      0,
    );
    const tiendaAuto = tiendaAutoRows.reduce(
      (sum, row) => sum + this.getTiendaRowTotal(row),
      0,
    );
    const tiendaVentas = tiendaAutoRows.length
      ? 0
      : ventasSnapshot
          .filter((venta) => this.normalizeVentaUbicacion(venta) === 'TIENDA')
          .reduce((sum, venta) => sum + Number(venta?.total || 0), 0);
    const tiendaPedidos = tiendaAutoRows.length
      ? 0
      : pedidosSnapshot
          .reduce(
            (sum, pedido) =>
              sum +
              this.getPedidoPagosReporte(pedido, data?.fecha)
                .filter((pago) => this.normalizeVentaUbicacion({ ...pedido, ubicacion: pago?.ubicacion || pedido?.ubicacion }) === 'TIENDA')
                .reduce((pagoSum, pago) => pagoSum + this.getPagoMontoAplicado(pago), 0),
            0,
          );
    const tiendaManual = tiendaManualRows.reduce(
      (sum, row) => sum + this.getTiendaRowTotal(row),
      0,
    );

    return capital + departamento + tiendaAuto + tiendaVentas + tiendaPedidos + tiendaManual;
  }

  private asArray(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
  }

  private getTiendaRowTotal(row: any) {
    return (
      Number(row?.total || 0) ||
      Number(row?.transferencia || 0) +
        Number(row?.deposito || 0) +
        Number(row?.tarjeta || 0) +
        Number(row?.efectivo || 0)
    );
  }

  private normalizeVentaUbicacion(venta: any) {
    const fallback = `${venta?.bodega?.ubicacion || venta?.bodega?.nombre || ''}`.trim();
    const normalized = `${venta?.ubicacion || fallback || 'TIENDA'}`
      .trim()
      .toUpperCase();
    if (normalized.includes('CAPITAL')) return 'CAPITAL';
    if (normalized.includes('DEPART')) return 'DEPARTAMENTO';
    if (normalized.includes('ANTIGUA')) return 'DEPARTAMENTO';
    return 'TIENDA';
  }

  private toDateOnly(value?: string | Date | null) {
    if (!value) return '';
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) return `${value}`.slice(0, 10);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  }

  private getPedidoMontoReporte(pedido: any, reporteFecha?: string | null) {
    const fechaReporte = this.toDateOnly(reporteFecha || pedido?.fecha);
    const pagos = this.asArray(pedido?.pagos).filter((pago) => {
      const pagoFecha = this.toDateOnly(pago?.fecha);
      return !pagoFecha || !fechaReporte || pagoFecha === fechaReporte;
    });
    const totalPagos = pagos.reduce(
      (sum, pago) => sum + this.getPagoMontoAplicado(pago),
      0,
    );
    return totalPagos > 0 ? totalPagos : Number(pedido?.anticipo || 0);
  }

  private getPagoMontoAplicado(pago: any) {
    return Number(pago?.monto || 0) + Number(pago?.recargo || 0);
  }

  private getPedidoPagosReporte(pedido: any, reporteFecha?: string | null) {
    const fechaReporte = this.toDateOnly(reporteFecha || pedido?.fecha);
    const pagos = this.asArray(pedido?.pagos).filter((pago) => {
      const pagoFecha = this.toDateOnly(pago?.fecha);
      return pagoFecha && fechaReporte && pagoFecha === fechaReporte && this.getPagoMontoAplicado(pago) > 0;
    });
    if (pagos.length) return pagos;
    if (this.toDateOnly(pedido?.fecha) !== fechaReporte || Number(pedido?.anticipo || 0) <= 0) return [];
    return [
      {
        metodo: pedido?.metodoPago,
        referencia: pedido?.pagos?.[0]?.referencia || null,
        banco: pedido?.pagos?.[0]?.banco || null,
        ubicacion: pedido?.pagos?.[0]?.ubicacion || pedido?.ubicacion || null,
        fecha: pedido?.fecha,
        monto: Number(pedido?.anticipo || 0),
        recargo: 0,
      },
    ];
  }

  private getReporteQuincenalTotal(data: any) {
    const ventasPorDia =
      data?.ventasPorDia && typeof data.ventasPorDia === 'object'
        ? data.ventasPorDia
        : {};
    return Object.values(ventasPorDia).reduce<number>(
      (sum: number, value: any) => sum + Number(value || 0),
      0,
    );
  }
}
