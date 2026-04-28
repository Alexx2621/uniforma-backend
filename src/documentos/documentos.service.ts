import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CorrelativosService } from '../correlativos/correlativos.service';
import { ReportesService } from '../reportes/reportes.service';

const DOCUMENTO_OPERACION: Record<string, string> = {
  cotizacion: 'cotizacion',
  reporteDiario: 'reporteDiario',
  reporteQuincenal: 'reporteQuincenal',
};

@Injectable()
export class DocumentosService {
  constructor(
    private prisma: PrismaService,
    private correlativos: CorrelativosService,
    private reportesService: ReportesService,
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

  listar(tipo?: string, usuarioId?: number) {
    const where: any = {};
    if (tipo) {
      where.tipo = this.normalizeTipo(tipo);
    }
    if (usuarioId !== undefined) {
      if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
        throw new BadRequestException('Usuario no valido');
      }
      where.usuarioId = usuarioId;
    }
    return this.prisma.documentoGenerado.findMany({
      where,
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            usuario: true,
            usuarioCorrelativo: true,
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async obtener(id: number) {
    const documento = await this.prisma.documentoGenerado.findUnique({
      where: { id },
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            usuario: true,
            usuarioCorrelativo: true,
          },
        },
      },
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    return documento;
  }

  async crear(usuarioId: number, body: { tipo?: string; titulo?: string; data?: unknown }) {
    this.ensureUsuario(usuarioId);
    const tipo = this.normalizeTipo(body.tipo);
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

    // Si es reporte diario, verificar si todas las tiendas han enviado y enviar correo
    if (tipo === 'reporteDiario') {
      await this.checkAndSendDailyReportEmail(documento);
    }

    return documento;
  }

  async actualizar(id: number, body: { titulo?: string; data?: unknown }) {
    await this.obtener(id);
    const documento = await this.prisma.documentoGenerado.update({
      where: { id },
      data: {
        titulo: body.titulo !== undefined ? `${body.titulo || ''}`.trim() || null : undefined,
        data: body.data !== undefined ? (body.data ?? {}) as object : undefined,
      },
    });

    if (documento.tipo === 'reporteDiario') {
      await this.checkAndSendDailyReportEmail(documento);
    }

    return documento;
  }

  async eliminar(id: number) {
    await this.obtener(id);
    return this.prisma.documentoGenerado.delete({ where: { id } });
  }

  async generarPdf(id: number) {
    const documento = await this.obtener(id);
    if (documento.tipo !== 'reporteDiario') {
      throw new BadRequestException('El documento no soporta exportacion PDF');
    }

    const data = documento.data as any;
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

  private getReporteDiarioTotal(data: any) {
    const capitalRows = Array.isArray(data?.capitalRows) ? data.capitalRows : [];
    const departamentoRows = Array.isArray(data?.departamentoRows)
      ? data.departamentoRows
      : [];
    const ventasSnapshot = Array.isArray(data?.ventasSnapshot)
      ? data.ventasSnapshot
      : [];
    const tiendaManualRows = Array.isArray(data?.tiendaManualRows)
      ? data.tiendaManualRows
      : [];
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
    const tiendaVentas = ventasSnapshot.reduce(
      (sum, venta) => sum + Number(venta?.total || 0),
      0,
    );
    const tiendaManual = tiendaManualRows.reduce(
      (sum, row) =>
        sum +
        (Number(row?.total || 0) ||
          Number(row?.transferencia || 0) +
            Number(row?.tarjeta || 0) +
            Number(row?.efectivo || 0)),
      0,
    );

    return capital + departamento + tiendaVentas + tiendaManual;
  }
}
