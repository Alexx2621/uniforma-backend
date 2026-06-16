import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { createTransport } from 'nodemailer';
import PDFDocument from 'pdfkit';
import puppeteer from 'puppeteer';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotificacionesConfigService } from '../config/notificaciones.service';

type ReporteConfigItem = {
  tipo: string;
  enabled: boolean;
  emailTo: string;
  subject: string;
  triggerOn: string[];
};

const MONTH_NAMES = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
];

const WEEKDAY_NAMES = [
  'DOMINGO',
  'LUNES',
  'MARTES',
  'MIERCOLES',
  'JUEVES',
  'VIERNES',
  'SABADO',
];

@Injectable()
export class ReportesService {
  private readonly logger = new Logger(ReportesService.name);

  constructor(private configService: NotificacionesConfigService) {}

  private formatGeneratedAt(date = new Date()) {
    return new Intl.DateTimeFormat('es-GT', {
      timeZone: 'America/Guatemala',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
      .format(date)
      .replace(',', '');
  }

  async sendDailyReportEmail(
    fecha: string,
    total: number,
    reporteData?: any,
  ) {
    const config = await this.configService.getConfig();
    const rule = this.getReporteRule(config.reportesConfig, 'reporteDiario');
    if (!rule?.enabled) {
      this.logger.log(
        'Reporte diario deshabilitado en configuracion. No se enviara correo.',
      );
      return;
    }

    const recipients = this.getRecipients(
      rule.emailTo || config.emailTo || process.env.REPORT_EMAIL_TO || '',
    );
    if (!recipients.length) {
      this.logger.warn(
        'No hay destinatarios configurados para el reporte diario.',
      );
      return;
    }

    const generatedBy = reporteData?.generadoPor || 'Uniforma';
    const defaultSubject = `Reporte diario ${fecha} - ${generatedBy}`;
    const subjectTemplate = rule.subject || defaultSubject;
    const subjectBase = subjectTemplate
      .replace('{fecha}', fecha)
      .replace('{generadoPor}', generatedBy);
    const subject = subjectTemplate.includes('{generadoPor}')
      ? subjectBase
      : `${subjectBase} - ${generatedBy}`;
    const html = this.buildDailyReportHtml(fecha, total, reporteData);

    try {
      await this.sendMail(
        recipients,
        subject,
        html,
        config,
        fecha,
        total,
        reporteData,
        {
          pdfFilename: `reporte-diario-${fecha}.pdf`,
          pdfBuilder: () => this.buildDailyReportPdf(fecha, reporteData),
          templateVariables: {
            fecha,
            total,
            totalFormatted: `Q ${total.toFixed(2)}`,
          },
          logLabel: 'reporte diario',
        },
      );
      this.logger.log(
        `Correo de reporte diario enviado a: ${recipients.join(', ')}`,
      );
    } catch (error: any) {
      this.logger.error(
        'Error enviando correo de reporte diario',
        error?.message || error,
      );
    }
  }

  async sendFortnightlyReportEmail(total: number, reporteData?: any) {
    const config = await this.configService.getConfig();
    const dailyRule = this.getReporteRule(
      config.reportesConfig,
      'reporteDiario',
    );
    const ownRule = this.getReporteRule(
      config.reportesConfig,
      'reporteQuincenal',
    );
    const rule = ownRule?.enabled ? ownRule : dailyRule;
    if (!rule?.enabled) {
      this.logger.log(
        'Reporte quincenal deshabilitado en configuracion. No se enviara correo.',
      );
      return;
    }

    const recipients = this.getRecipients(
      rule.emailTo || config.emailTo || process.env.REPORT_EMAIL_TO || '',
    );
    if (!recipients.length) {
      this.logger.warn(
        'No hay destinatarios configurados para el reporte quincenal.',
      );
      return;
    }

    const periodo = this.getFortnightlyPeriodLabel(reporteData);
    const generatedBy =
      reporteData?.generadoPor || reporteData?.vendedor || 'Uniforma';
    const defaultSubject = `Reporte quincenal ${periodo} - ${generatedBy}`;
    const subjectTemplate =
      ownRule?.enabled && ownRule.subject ? ownRule.subject : defaultSubject;
    const subjectBase = subjectTemplate
      .replace('{fecha}', periodo)
      .replace('{periodo}', periodo)
      .replace('{generadoPor}', generatedBy);
    const subject =
      subjectTemplate.includes('{generadoPor}') || subjectBase.endsWith(generatedBy)
        ? subjectBase
        : `${subjectBase} - ${generatedBy}`;
    const html = this.buildFortnightlyReportEmailHtml(
      periodo,
      total,
      reporteData,
    );
    const reporteNo = reporteData?.reporteNo || 'reporte-quincenal';

    try {
      await this.sendMail(
        recipients,
        subject,
        html,
        config,
        periodo,
        total,
        reporteData,
        {
          pdfFilename: `reporte-quincenal-${reporteNo}.pdf`,
          pdfBuilder: () => this.buildFortnightlyReportPdf(reporteData),
          templateVariables: {
            fecha: periodo,
            periodo,
            total,
            totalFormatted: `Q ${total.toFixed(2)}`,
          },
          logLabel: 'reporte quincenal',
        },
      );
      this.logger.log(
        `Correo de reporte quincenal enviado a: ${recipients.join(', ')}`,
      );
    } catch (error: any) {
      this.logger.error(
        'Error enviando correo de reporte quincenal',
        error?.message || error,
      );
    }
  }

  private getReporteRule(
    reportesConfig: any,
    tipo: string,
  ): ReporteConfigItem | undefined {
    if (!reportesConfig || !Array.isArray(reportesConfig.reportes)) {
      return undefined;
    }
    return reportesConfig.reportes.find((item: any) => item?.tipo === tipo);
  }

  private getRecipients(raw: string) {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private buildDailyReportHtml(
    fecha: string,
    total: number,
    reporteData?: any,
  ) {
    const resumen = this.getDailyReportSummary(reporteData, total);
    const generadoPor = reporteData?.generadoPor || 'Uniforma';
    const logoUrl = process.env.EMAIL_LOGO_URL || '';
    const logoHtml = logoUrl
      ? `<img src="${this.escapeHtml(logoUrl)}" width="240" alt="Uniforma" style="display:block;width:240px;max-width:78%;height:auto;margin:0 auto 22px;">`
      : `<img src="cid:uniforma-logo" width="260" alt="Uniforma" style="display:block;width:260px;max-width:82%;height:auto;margin:0 auto 22px;">`;
    const emailFont =
      '"Myriad Pro", "MyriadPro-Regular", "Myriad Pro Regular", "Aptos", "Segoe UI", Arial, Helvetica, sans-serif';
    const emailBoldFont =
      '"Myriad Pro Bold", "MyriadPro-Bold", "Myriad Pro", "Aptos Bold", "Segoe UI Bold", "Segoe UI", Arial, Helvetica, sans-serif';

    return `
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Reporte diario</title>
        </head>
        <body style="margin:0;background:#f3f4f6;font-family:${emailFont};color:#111827;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:32px 16px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb;">
                  <tr>
                    <td style="padding:36px 34px 30px;text-align:center;">
                      ${logoHtml}
                      <p style="margin:0 0 10px;color:#d90000;font-family:${emailBoldFont};font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;">Reporte disponible</p>
                      <h1 style="margin:0;color:#1f3f87;font-family:${emailBoldFont};font-size:30px;line-height:1.2;font-weight:800;">Reporte diario</h1>
                      <p style="margin:14px auto 0;color:#334155;font-size:15px;line-height:1.6;max-width:440px;">Hola, <strong style="color:#1f3f87;font-family:${emailBoldFont};">${this.escapeHtml(generadoPor)}</strong> genero el reporte diario del <strong style="color:#d90000;font-family:${emailBoldFont};">${this.escapeHtml(fecha)}</strong>. Puedes revisar el detalle completo en el PDF adjunto.</p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:0 34px 30px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;">
                        <tr>
                          <td style="padding:18px 20px;border-bottom:1px solid #e5e7eb;">
                            <p style="margin:0;color:#1f3f87;font-family:${emailBoldFont};font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Fecha</p>
                            <p style="margin:6px 0 0;color:#d90000;font-family:${emailBoldFont};font-size:16px;font-weight:700;">${this.escapeHtml(fecha)}</p>
                          </td>
                          <td style="padding:18px 20px;border-bottom:1px solid #e5e7eb;">
                            <p style="margin:0;color:#1f3f87;font-family:${emailBoldFont};font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Generado por</p>
                            <p style="margin:6px 0 0;color:#111827;font-family:${emailBoldFont};font-size:16px;font-weight:700;">${this.escapeHtml(generadoPor)}</p>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:18px 20px;">
                            <p style="margin:0;color:#1f3f87;font-family:${emailBoldFont};font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Total</p>
                            <p style="margin:6px 0 0;color:#d90000;font-family:${emailBoldFont};font-size:16px;font-weight:700;">${this.formatCurrency(resumen.total)}</p>
                          </td>
                          <td style="padding:18px 20px;">
                            <p style="margin:0;color:#1f3f87;font-family:${emailBoldFont};font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Archivo adjunto</p>
                            <p style="margin:6px 0 0;color:#111827;font-family:${emailBoldFont};font-size:16px;font-weight:700;">PDF</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <tr>
                    <td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;">
                      <p style="margin:0;color:#475569;font-size:12px;line-height:1.5;text-align:center;">Este correo fue generado automaticamente por <strong style="color:#1f3f87;">Uniforma</strong>.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;
  }

  private buildFortnightlyReportEmailHtml(
    periodo: string,
    total: number,
    reporteData?: any,
  ) {
    const generadoPor =
      reporteData?.generadoPor || reporteData?.vendedor || 'Uniforma';
    const tienda = reporteData?.tienda || '-';
    const logoUrl = process.env.EMAIL_LOGO_URL || '';
    const logoHtml = logoUrl
      ? `<img src="${this.escapeHtml(logoUrl)}" width="240" alt="Uniforma" style="display:block;width:240px;max-width:78%;height:auto;margin:0 auto 22px;">`
      : `<img src="cid:uniforma-logo" width="260" alt="Uniforma" style="display:block;width:260px;max-width:82%;height:auto;margin:0 auto 22px;">`;
    const emailFont =
      '"Myriad Pro", "MyriadPro-Regular", "Myriad Pro Regular", "Aptos", "Segoe UI", Arial, Helvetica, sans-serif';
    const emailBoldFont =
      '"Myriad Pro Bold", "MyriadPro-Bold", "Myriad Pro", "Aptos Bold", "Segoe UI Bold", "Segoe UI", Arial, Helvetica, sans-serif';

    return `
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Reporte quincenal</title>
        </head>
        <body style="margin:0;background:#f3f4f6;font-family:${emailFont};color:#111827;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:32px 16px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb;">
                  <tr>
                    <td style="padding:36px 34px 30px;text-align:center;">
                      ${logoHtml}
                      <p style="margin:0 0 10px;color:#d90000;font-family:${emailBoldFont};font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;">Reporte disponible</p>
                      <h1 style="margin:0;color:#1f3f87;font-family:${emailBoldFont};font-size:30px;line-height:1.2;font-weight:800;">Reporte quincenal</h1>
                      <p style="margin:14px auto 0;color:#334155;font-size:15px;line-height:1.6;max-width:440px;">Hola, <strong style="color:#1f3f87;font-family:${emailBoldFont};">${this.escapeHtml(generadoPor)}</strong> genero el reporte quincenal de <strong style="color:#d90000;font-family:${emailBoldFont};">${this.escapeHtml(periodo)}</strong>. Puedes revisar el detalle completo en el PDF adjunto.</p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:0 34px 30px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;">
                        <tr>
                          <td style="padding:18px 20px;border-bottom:1px solid #e5e7eb;">
                            <p style="margin:0;color:#1f3f87;font-family:${emailBoldFont};font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Periodo</p>
                            <p style="margin:6px 0 0;color:#d90000;font-family:${emailBoldFont};font-size:16px;font-weight:700;">${this.escapeHtml(periodo)}</p>
                          </td>
                          <td style="padding:18px 20px;border-bottom:1px solid #e5e7eb;">
                            <p style="margin:0;color:#1f3f87;font-family:${emailBoldFont};font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Generado por</p>
                            <p style="margin:6px 0 0;color:#111827;font-family:${emailBoldFont};font-size:16px;font-weight:700;">${this.escapeHtml(generadoPor)}</p>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:18px 20px;">
                            <p style="margin:0;color:#1f3f87;font-family:${emailBoldFont};font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Tienda</p>
                            <p style="margin:6px 0 0;color:#111827;font-family:${emailBoldFont};font-size:16px;font-weight:700;">${this.escapeHtml(tienda)}</p>
                          </td>
                          <td style="padding:18px 20px;">
                            <p style="margin:0;color:#1f3f87;font-family:${emailBoldFont};font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Total</p>
                            <p style="margin:6px 0 0;color:#d90000;font-family:${emailBoldFont};font-size:16px;font-weight:700;">${this.formatCurrency(total)}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <tr>
                    <td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;">
                      <p style="margin:0;color:#475569;font-size:12px;line-height:1.5;text-align:center;">Este correo fue generado automaticamente por <strong style="color:#1f3f87;">Uniforma</strong>.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;
  }

  private getDailyReportSummary(reporteData: any, fallbackTotal: number) {
    const capitalRows = this.asArray(reporteData?.capitalRows);
    const departamentoRows = this.asArray(reporteData?.departamentoRows);
    const tiendaRows = this.getTiendaRowsFromReport(reporteData);
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
    const tienda = tiendaRows.reduce(
      (sum, row) => sum + this.getTiendaRowTotal(row),
      0,
    );
    const total = capital + departamento + tienda;

    return {
      capital,
      departamento,
      tienda,
      total: total || fallbackTotal,
      registros: capitalRows.length + departamentoRows.length + tiendaRows.length,
    };
  }

  private buildCapitalRows(rows: unknown) {
    return this.asArray(rows).map((row) => [
      row?.envio || '-',
      this.formatCurrency(row?.transferencia),
      this.formatCurrency(row?.deposito),
      this.formatCurrency(row?.efectivo),
    ]);
  }

  private buildDepartamentoRows(rows: unknown) {
    return this.asArray(rows).map((row) => [
      row?.envio || '-',
      this.formatCurrency(row?.transferencia),
      this.formatCurrency(row?.deposito),
    ]);
  }

  private buildTiendaRows(reporteData: any) {
    return this.getTiendaRowsFromReport(reporteData).map((row) => [
      row?.recibo || '-',
      this.formatCurrency(row?.transferencia),
      this.formatCurrency(row?.tarjeta),
      this.formatCurrency(row?.efectivo),
      this.formatCurrency(this.getTiendaRowTotal(row)),
    ]);
  }

  private buildSectionTable(
    title: string,
    headers: string[],
    rows: Array<Array<string>>,
  ) {
    const headerHtml = headers
      .map(
        (header, index) =>
          `<th align="${index === 0 ? 'left' : 'right'}" style="padding:0 0 10px;border-bottom:1px solid #d1d5db;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.05em;">${this.escapeHtml(header)}</th>`,
      )
      .join('');
    const rowsHtml = rows.length
      ? rows
          .map(
            (row) => `
              <tr>
                ${row
                  .map(
                    (cell, index) =>
                      `<td align="${index === 0 ? 'left' : 'right'}" style="padding:12px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;${index === 0 ? 'font-weight:600;' : ''}">${this.escapeHtml(cell)}</td>`,
                  )
                  .join('')}
              </tr>
            `,
          )
          .join('')
      : `<tr><td colspan="${headers.length}" style="padding:14px 0;color:#6b7280;font-size:14px;border-bottom:1px solid #e5e7eb;">Sin datos registrados</td></tr>`;

    return `
      <h2 style="margin:0 0 12px;color:#111827;font-size:18px;line-height:1.3;">${this.escapeHtml(title)}</h2>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 26px;">
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  }

  private getTiendaRowsFromReport(reporteData: any) {
    const tiendaAutoRows = this.asArray(reporteData?.tiendaAutoRows);
    const ventasSnapshotRows = tiendaAutoRows.length
      ? []
      : this.asArray(reporteData?.ventasSnapshot)
      .filter((venta) => this.normalizeVentaUbicacion(venta) === 'TIENDA')
      .map((venta) => {
        const metodo = this.normalizarMetodoPago(venta?.metodoPago);
        const referencia = `${venta?.pagos?.[0]?.referencia || ''}`.trim();
        const banco = `${venta?.pagos?.[0]?.banco || ''}`.trim();
        const total = Number(venta?.total || 0);
        return {
          fecha: reporteData?.fecha || '',
          recibo: venta?.folio || `V-${venta?.id || ''}`,
          transferencia: metodo === 'transferencia' ? total : 0,
          autorizacionTransferencia:
            metodo === 'transferencia' ? referencia : '',
          deposito: metodo === 'deposito_bancario' ? total : 0,
          boleta: metodo === 'deposito_bancario' ? referencia : '',
          banco: metodo === 'deposito_bancario' ? banco : '',
          tarjeta:
            metodo === 'tarjeta' || metodo === 'visalink' ? total : 0,
          autorizacionTarjeta:
            metodo === 'tarjeta' || metodo === 'visalink' ? referencia : '',
          efectivo: metodo === 'efectivo' ? total : 0,
          total,
          observaciones: '',
        };
      });
    const pedidosSnapshotRows = tiendaAutoRows.length
      ? []
      : this.asArray(reporteData?.pedidosSnapshot)
          .flatMap((pedido) =>
            this.getPedidoPagosReporte(pedido, reporteData?.fecha)
              .filter((pago) => this.normalizeVentaUbicacion({ ...pedido, ubicacion: pago?.ubicacion || pedido?.ubicacion }) === 'TIENDA')
              .map((pago) => {
                const metodo = this.normalizarMetodoPago(pago?.metodo || pedido?.metodoPago);
                const referencia = `${pago?.referencia || pedido?.pagos?.[0]?.referencia || ''}`.trim();
                const banco = `${pago?.banco || pedido?.pagos?.[0]?.banco || ''}`.trim();
                const total = this.getPagoMontoAplicado(pago);
                return {
                  fecha: reporteData?.fecha || '',
                  recibo: pedido?.folio || `PE-${pedido?.id || ''}`,
                  transferencia: metodo === 'transferencia' ? total : 0,
                  autorizacionTransferencia:
                    metodo === 'transferencia' ? referencia : '',
                  deposito: metodo === 'deposito_bancario' ? total : 0,
                  boleta: metodo === 'deposito_bancario' ? referencia : '',
                  banco: metodo === 'deposito_bancario' ? banco : '',
                  tarjeta:
                    metodo === 'tarjeta' || metodo === 'visalink' ? total : 0,
                  autorizacionTarjeta:
                    metodo === 'tarjeta' || metodo === 'visalink' ? referencia : '',
                  efectivo: metodo === 'efectivo' ? total : 0,
                  total,
                  observaciones: '',
                };
              }),
          )
          .filter((row) => this.getTiendaRowTotal(row) > 0);

    return [
      ...tiendaAutoRows,
      ...ventasSnapshotRows,
      ...pedidosSnapshotRows,
      ...this.asArray(reporteData?.tiendaManualRows),
    ];
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

  private getPagoMontoAplicado(pago: any) {
    return Number(pago?.monto || 0) + Number(pago?.recargo || 0);
  }

  private getPedidoMontoReporte(pedido: any, reporteFecha?: string | null) {
    const fechaReporte = this.toDateOnly(reporteFecha || pedido?.fecha);
    const pagos = this.asArray(pedido?.pagos).filter((pago) => {
      const pagoFecha = this.toDateOnly(pago?.fecha);
      return !pagoFecha || !fechaReporte || pagoFecha === fechaReporte;
    });
    const totalPagos = pagos.reduce((sum, pago) => sum + this.getPagoMontoAplicado(pago), 0);
    return totalPagos > 0 ? totalPagos : Number(pedido?.anticipo || 0);
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

  private normalizarMetodoPago(value?: string | null) {
    const normalized = `${value || ''}`
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ');
    if (!normalized) return '';
    if (normalized.includes('transfer')) return 'transferencia';
    if (normalized.includes('deposit')) return 'deposito_bancario';
    if (normalized.includes('visa link') || normalized.includes('visalink')) {
      return 'visalink';
    }
    if (normalized.includes('tarjeta')) return 'tarjeta';
    if (normalized.includes('efectivo')) return 'efectivo';
    return normalized.replace(/\s+/g, '_');
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

  private asArray(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
  }

  private getFirstExistingPath(paths: string[]) {
    return paths.find((path) => existsSync(path)) || '';
  }

  private getLogoDataUri() {
    const logoPath = this.getFirstExistingPath([
      join(process.cwd(), 'src', 'assets', 'uniforma-logo-horizontal.png'),
      join(
        process.cwd(),
        '..',
        'uniforma-frontend',
        'src',
        'assets',
        'uniforma-logo.png',
      ),
    ]);
    if (!existsSync(logoPath)) {
      return '';
    }

    const base64 = readFileSync(logoPath).toString('base64');
    return `data:image/png;base64,${base64}`;
  }

  private getReportPdfLogoDataUri() {
    const logoPath = this.getFirstExistingPath([
      join(process.cwd(), 'src', 'assets', 'uniforma-logo-round.png'),
      join(
        process.cwd(),
        '..',
        'uniforma-frontend',
        'src',
        'assets',
        '3-logos.png',
      ),
    ]);
    if (!existsSync(logoPath)) {
      return this.getLogoDataUri();
    }

    const base64 = readFileSync(logoPath).toString('base64');
    return `data:image/png;base64,${base64}`;
  }

  private getLogoBuffer() {
    const logoPath = this.getFirstExistingPath([
      join(process.cwd(), 'src', 'assets', 'uniforma-logo-horizontal.png'),
      join(
        process.cwd(),
        '..',
        'uniforma-frontend',
        'src',
        'assets',
        'uniforma-logo.png',
      ),
    ]);
    return existsSync(logoPath) ? readFileSync(logoPath) : null;
  }

  private async buildDailyReportPdf(fecha: string, reporteData: any) {
    const html = this.buildDailyReportPrintHtml(fecha, reporteData);
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.emulateMediaType('print');
      return Buffer.from(
        await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
        }),
      );
    } finally {
      await browser.close();
    }
  }

  generarReporteDiarioPdf(fecha: string, reporteData: any) {
    return this.buildDailyReportPdf(fecha, reporteData);
  }

  private async buildFortnightlyReportPdf(reporteData: any) {
    const html = this.buildFortnightlyReportPrintHtml(reporteData || {});
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.emulateMediaType('print');
      return Buffer.from(
        await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
        }),
      );
    } finally {
      await browser.close();
    }
  }

  generarReporteQuincenalPdf(reporteData: any) {
    return this.buildFortnightlyReportPdf(reporteData);
  }

  generarReporteMensualPdf(reporteData: any) {
    return this.buildMonthlyReportPdf(reporteData);
  }

  generarReporteMensualConsolidadoPdf(documentos: any[]) {
    return this.buildMonthlyConsolidatedReportPdf(documentos);
  }

  private async buildMonthlyConsolidatedReportPdf(documentos: any[]) {
    const html = this.buildMonthlyConsolidatedReportPrintHtml(documentos || []);
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.emulateMediaType('print');
      return Buffer.from(
        await page.pdf({
          format: 'A4',
          landscape: true,
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
        }),
      );
    } finally {
      await browser.close();
    }
  }

  private buildMonthlyConsolidatedReportPrintHtml(documentos: any[]) {
    const normalized = documentos.map((doc) => {
      const data = doc?.data || {};
      const ventasPorDia = data?.ventasPorDia && typeof data.ventasPorDia === 'object' ? data.ventasPorDia : {};
      const total = Object.values(ventasPorDia).reduce<number>((sum, value: any) => sum + Number(value || 0), 0);
      const diasConVenta = Object.values(ventasPorDia).filter((value: any) => Number(value || 0) > 0).length;
      const month = Number(data?.month || new Date().getMonth() + 1);
      const safeMonth = Math.min(Math.max(month, 1), 12);
      return {
        id: doc.id,
        correlativo: doc.correlativo,
        vendedor: `${data?.vendedor || doc?.usuario?.nombre || doc?.usuario?.usuario || 'N/D'}`.trim().toUpperCase(),
        tienda: `${data?.tienda || 'N/D'}`.trim().toUpperCase(),
        month: safeMonth,
        year: Number(data?.year || new Date().getFullYear()),
        metaMes: Number(data?.metaMes || 0),
        ventasPorDia,
        total,
        diasConVenta,
      };
    });
    const first = normalized[0];
    const titleMonth = first ? `${MONTH_NAMES[first.month - 1]} ${first.year}` : 'MES';
    const totalGeneral = normalized.reduce((sum, row) => sum + row.total, 0);
    const metaGeneral = normalized.reduce((sum, row) => sum + row.metaMes, 0);
    const avance = metaGeneral > 0 ? (totalGeneral / metaGeneral) * 100 : 0;
    const dias = Array.from(
      new Set(
        normalized.flatMap((doc) =>
          Object.entries(doc.ventasPorDia)
            .filter(([, value]) => Number(value || 0) > 0)
            .map(([day]) => Number(day)),
        ),
      ),
    ).sort((a, b) => a - b);
    const ventasPorDia = dias.map((day) => ({
      day,
      total: normalized.reduce((sum, doc) => sum + Number(doc.ventasPorDia?.[day] || 0), 0),
    }));
    const maxDia = Math.max(...ventasPorDia.map((row) => row.total), 1);
    const topVendedor = [...normalized].sort((a, b) => b.total - a.total)[0];
    const promedioDiaActivo = ventasPorDia.length ? totalGeneral / ventasPorDia.length : 0;
    const logo = this.getReportPdfLogoDataUri();
    const fontFamily =
      '"Myriad Pro", "MyriadPro-Regular", "Myriad Pro Regular", "Aptos", "Segoe UI", Arial, Helvetica, sans-serif';
    const fontSemi =
      '"Myriad Pro Semibold", "Myriad Pro SemiBold", "MyriadPro-Semibold", "Myriad Pro", "Aptos SemiBold", "Segoe UI Semibold", "Segoe UI", Arial, Helvetica, sans-serif';
    const fontBold =
      '"Myriad Pro Bold", "MyriadPro-Bold", "Myriad Pro", "Aptos Bold", "Segoe UI Bold", "Segoe UI", Arial, Helvetica, sans-serif';

    return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Reporte mensual consolidado ${this.escapeHtml(titleMonth)}</title>
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        html, body, .page, table, th, td, .kpi, .bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { margin: 0; background: #fff; color: #111827; font-family: ${fontFamily}; }
        .page { padding: 4mm 0 0; }
        .header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .brand img { width: 58px; height: 58px; object-fit: contain; }
        h1 { margin: 0; color: #1f3f87; font-family: ${fontBold}; font-size: 22px; line-height: 1.1; }
        .subtitle { margin: 4px 0 0; color: #475569; font-size: 11px; }
        .stamp { background: #d90000; color: #fff; padding: 6px 12px; font-family: ${fontBold}; font-size: 12px; }
        .kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 10px 0 12px; }
        .kpi { border: 1px solid #d9e2f3; padding: 8px; min-height: 46px; }
        .kpi-label { color: #475569; font-size: 9px; text-transform: uppercase; }
        .kpi-value { color: #111827; font-family: ${fontBold}; font-size: 15px; margin-top: 4px; }
        .section-title { background: #1f3f87; color: #fff; font-family: ${fontBold}; font-size: 11px; padding: 5px 8px; margin-top: 10px; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9px; }
        th { background: #d9d9d9; color: #111827; font-family: ${fontSemi}; padding: 4px 5px; text-align: left; }
        td { border-bottom: 1px solid #e5e7eb; padding: 4px 5px; vertical-align: middle; }
        td.num, th.num { text-align: right; white-space: nowrap; }
        .chart { display: grid; grid-template-columns: repeat(${Math.max(ventasPorDia.length, 1)}, 1fr); gap: 3px; height: 120px; align-items: end; border: 1px solid #e5e7eb; padding: 8px; margin-top: 8px; }
        .bar-wrap { text-align: center; min-width: 12px; }
        .bar { background: #1f3f87; min-height: 2px; }
        .bar-label { font-size: 7px; color: #475569; margin-top: 3px; }
        .vendor-bars { display: grid; gap: 5px; margin-top: 8px; }
        .vendor-row { display: grid; grid-template-columns: 155px 1fr 90px; gap: 8px; align-items: center; font-size: 9px; }
        .vendor-bar-track { height: 12px; background: #eef2ff; }
        .vendor-bar { height: 12px; background: #d90000; }
        .footer-note { margin-top: 8px; color: #64748b; font-size: 8px; }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="header">
          <div class="brand">
            ${logo ? `<img src="${logo}" alt="Uniforma" />` : ''}
            <div>
              <h1>Reporte mensual consolidado</h1>
              <p class="subtitle">${this.escapeHtml(titleMonth)} · ${normalized.length} reporte(s) seleccionado(s)</p>
            </div>
          </div>
          <div class="stamp">${this.formatCurrency(totalGeneral)}</div>
        </div>

        <div class="kpis">
          <div class="kpi"><div class="kpi-label">Venta consolidada</div><div class="kpi-value">${this.formatCurrency(totalGeneral)}</div></div>
          <div class="kpi"><div class="kpi-label">Meta consolidada</div><div class="kpi-value">${this.formatCurrency(metaGeneral)}</div></div>
          <div class="kpi"><div class="kpi-label">Avance</div><div class="kpi-value">${this.formatPercent(avance)}</div></div>
          <div class="kpi"><div class="kpi-label">Dias con venta</div><div class="kpi-value">${ventasPorDia.length}</div></div>
          <div class="kpi"><div class="kpi-label">Promedio dia activo</div><div class="kpi-value">${this.formatCurrency(promedioDiaActivo)}</div></div>
        </div>

        <div class="section-title">Ventas por dia del mes</div>
        <div class="chart">
          ${
            ventasPorDia.length
              ? ventasPorDia
                  .map(
                    (row) =>
                      `<div class="bar-wrap"><div class="bar" style="height:${Math.max((row.total / maxDia) * 100, 2)}px"></div><div class="bar-label">${row.day}</div></div>`,
                  )
                  .join('')
              : '<div class="bar-label">Sin ventas</div>'
          }
        </div>

        <div class="section-title">Comparativo por vendedor</div>
        <div class="vendor-bars">
          ${normalized
            .sort((a, b) => b.total - a.total)
            .map(
              (row) =>
                `<div class="vendor-row"><div>${this.escapeHtml(row.vendedor)}</div><div class="vendor-bar-track"><div class="vendor-bar" style="width:${Math.max((row.total / Math.max(topVendedor?.total || 1, 1)) * 100, 2)}%"></div></div><div>${this.formatCurrency(row.total)}</div></div>`,
            )
            .join('')}
        </div>

        <div class="section-title">Detalle de reportes</div>
        <table>
          <thead><tr><th>Correlativo</th><th>Vendedor</th><th>Tienda</th><th class="num">Dias venta</th><th class="num">Meta</th><th class="num">Total</th><th class="num">Avance</th></tr></thead>
          <tbody>
            ${normalized
              .map(
                (row) =>
                  `<tr><td>${this.escapeHtml(row.correlativo)}</td><td>${this.escapeHtml(row.vendedor)}</td><td>${this.escapeHtml(row.tienda)}</td><td class="num">${row.diasConVenta}</td><td class="num">${this.formatCurrency(row.metaMes)}</td><td class="num">${this.formatCurrency(row.total)}</td><td class="num">${this.formatPercent(row.metaMes > 0 ? (row.total / row.metaMes) * 100 : 0)}</td></tr>`,
              )
              .join('')}
          </tbody>
        </table>

        <div class="footer-note">Mejor vendedor: ${this.escapeHtml(topVendedor?.vendedor || 'N/D')} · Generado desde Uniforma el ${this.formatGeneratedAt()}.</div>
      </div>
    </body>
  </html>`;
  }

  private async buildMonthlyReportPdf(reporteData: any) {
    const html = this.buildMonthlyReportPrintHtml(reporteData || {});
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.emulateMediaType('print');
      return Buffer.from(
        await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
        }),
      );
    } finally {
      await browser.close();
    }
  }

  private buildMonthlyReportPrintHtml(reporteData: any) {
    const month = Number(reporteData?.month || new Date().getMonth() + 1);
    const safeMonth = Math.min(Math.max(month, 1), 12);
    const year = Number(reporteData?.year || new Date().getFullYear());
    const tienda = `${reporteData?.tienda || '-'}`.trim().toUpperCase();
    const vendedor = `${reporteData?.vendedor || reporteData?.generadoPor || '-'}`.trim().toUpperCase();
    const metaMes = Number(reporteData?.metaMes || 0);
    const promedioDiario = Number(reporteData?.promedioDiario || 0);
    const reporteNo = reporteData?.reporteNo || '-';
    const rows = this.getMonthlyRows(year, safeMonth).map((row) => ({
      ...row,
      ventaDiaria: Number(reporteData?.ventasPorDia?.[row.day] || 0),
    }));
    const totalVenta = rows.reduce((sum, row) => sum + Number(row.ventaDiaria || 0), 0);
    const totalPorcentaje = metaMes > 0 ? (totalVenta / metaMes) * 100 : 0;
    const logo = this.getReportPdfLogoDataUri();
    const fontFamily =
      '"Myriad Pro", "MyriadPro-Regular", "Myriad Pro Regular", "Aptos", "Segoe UI", Arial, Helvetica, sans-serif';
    const fontSemi =
      '"Myriad Pro Semibold", "Myriad Pro SemiBold", "MyriadPro-Semibold", "Myriad Pro", "Aptos SemiBold", "Segoe UI Semibold", "Segoe UI", Arial, Helvetica, sans-serif';
    const fontBold =
      '"Myriad Pro Bold", "MyriadPro-Bold", "Myriad Pro", "Aptos Bold", "Segoe UI Bold", "Segoe UI", Arial, Helvetica, sans-serif';

    return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Reporte mensual ${this.escapeHtml(MONTH_NAMES[safeMonth - 1])} ${year}</title>
      <style>
        @page { size: portrait; margin: 10mm; }
        html, body, .page, table, th, td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { margin: 0; background: #fff; color: #111827; font-family: ${fontFamily}; }
        .page { width: 170mm; margin: 0 auto; padding: 4mm 0 0; }
        .top { display: flex; align-items: center; justify-content: center; gap: 6mm; width: 100%; margin: 0 auto 1.5mm; }
        .meta { width: 64mm; margin: 0; }
        .meta-row { display: grid; grid-template-columns: 32mm 32mm; min-height: 3.7mm; align-items: center; font-size: 10.5px; font-family: ${fontBold}; font-weight: 700; }
        .meta-label { background: #002060; color: #fff; text-align: right; padding: 0.35mm 1.5mm; }
        .meta-value { background: #ff3300; color: #fff; text-align: left; padding: 0.35mm 1.5mm; }
        .meta-row.vendor .meta-label, .meta-row.vendor .meta-value { background: #d9d9d9; color: #111827; }
        .logo { width: 25mm; height: 25mm; object-fit: contain; margin: 0; }
        table { width: 132mm; margin: 0 auto; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
        th { background: #d9d9d9; color: #111827; font-size: 11px; font-family: ${fontSemi}; font-weight: 600; text-align: center; padding: 0.35mm 1.2mm; border: none; }
        td { text-align: center; padding: 0.42mm 1.2mm; border: none; font-size: 11.5px; }
        td.money { white-space: nowrap; }
        .total-label { text-align: right; font-size: 12px; font-family: ${fontSemi}; font-weight: 600; }
        .total-value { background: #ff3300; color: #fff; font-size: 12px; font-family: ${fontBold}; font-weight: 700; white-space: nowrap; }
        .footer-note { margin-top: 8mm; color: #4b5563; font-size: 10px; }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="top">
          <div class="meta">
            <div class="meta-row"><div class="meta-label">TIENDA</div><div class="meta-value">${this.escapeHtml(tienda)}</div></div>
            <div class="meta-row"><div class="meta-label">MES</div><div class="meta-value">${this.escapeHtml(MONTH_NAMES[safeMonth - 1])}</div></div>
            <div class="meta-row vendor"><div class="meta-label">VENDEDOR</div><div class="meta-value">${this.escapeHtml(vendedor)}</div></div>
            <div class="meta-row"><div class="meta-label">META MES</div><div class="meta-value">${this.formatCurrency(metaMes)}</div></div>
            <div class="meta-row"><div class="meta-label">PROMEDIO DIARIO</div><div class="meta-value">${this.formatCurrency(promedioDiario)}</div></div>
            <div class="meta-row"><div class="meta-label">REPORTE No.</div><div class="meta-value">${this.escapeHtml(reporteNo)}</div></div>
          </div>
          ${logo ? `<img class="logo" src="${logo}" alt="Uniforma" />` : ''}
        </div>

        <table>
          <colgroup><col style="width: 18%;" /><col style="width: 28%;" /><col style="width: 28%;" /><col style="width: 26%;" /></colgroup>
          <thead><tr><th>FECHA</th><th>DIA</th><th>VENTA DIARIA</th><th>PORCENTAJE</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (row) => `<tr><td>${row.day}</td><td>${this.escapeHtml(row.weekday)}</td><td class="money">${this.formatCurrency(row.ventaDiaria)}</td><td>${this.formatPercent(metaMes > 0 ? (Number(row.ventaDiaria || 0) / metaMes) * 100 : 0)}</td></tr>`,
              )
              .join('')}
            <tr><td></td><td class="total-label">TOTAL MES</td><td class="total-value">${this.formatCurrency(totalVenta)}</td><td class="total-value">${this.formatPercent(totalPorcentaje)}</td></tr>
          </tbody>
        </table>
        <div class="footer-note">Generado desde Uniforma el ${this.formatGeneratedAt()}.</div>
      </div>
    </body>
  </html>`;
  }

  private buildFortnightlyReportPrintHtml(reporteData: any) {
    const month = Number(reporteData?.month || new Date().getMonth() + 1);
    const safeMonth = Math.min(Math.max(month, 1), 12);
    const year = Number(reporteData?.year || new Date().getFullYear());
    const quincena = reporteData?.quincena === '1' ? '1' : '2';
    const tienda = `${reporteData?.tienda || '-'}`.trim().toUpperCase();
    const vendedor = `${reporteData?.vendedor || reporteData?.generadoPor || '-'}`
      .trim()
      .toUpperCase();
    const metaMes = Number(reporteData?.metaMes || 0);
    const promedioDiario = Number(reporteData?.promedioDiario || 0);
    const reporteNo = reporteData?.reporteNo || '-';
    const rows = this.getFortnightlyRows(year, safeMonth, quincena).map((row) => ({
      ...row,
      ventaDiaria: Number(reporteData?.ventasPorDia?.[row.day] || 0),
    }));
    const totalVenta = rows.reduce(
      (sum, row) => sum + Number(row.ventaDiaria || 0),
      0,
    );
    const totalPorcentaje = metaMes > 0 ? (totalVenta / metaMes) * 100 : 0;
    const quincenaLabel =
      quincena === '1' ? '1RA QUINCENA' : '2DA QUINCENA';
    const logo = this.getReportPdfLogoDataUri();
    const fontFamily =
      '"Myriad Pro", "MyriadPro-Regular", "Myriad Pro Regular", "Aptos", "Segoe UI", Arial, Helvetica, sans-serif';
    const fontSemi =
      '"Myriad Pro Semibold", "Myriad Pro SemiBold", "MyriadPro-Semibold", "Myriad Pro", "Aptos SemiBold", "Segoe UI Semibold", "Segoe UI", Arial, Helvetica, sans-serif';
    const fontBold =
      '"Myriad Pro Bold", "MyriadPro-Bold", "Myriad Pro", "Aptos Bold", "Segoe UI Bold", "Segoe UI", Arial, Helvetica, sans-serif';

    return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Reporte quincenal ${this.escapeHtml(MONTH_NAMES[safeMonth - 1])} ${year}</title>
      <style>
        @page { size: portrait; margin: 10mm; }
        html, body, .page, table, th, td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { margin: 0; background: #fff; color: #111827; font-family: ${fontFamily}; }
        .page { width: 170mm; margin: 0 auto; padding: 4mm 0 0; }
        .top { display: flex; align-items: center; justify-content: center; gap: 6mm; width: 100%; margin: 0 auto 1.5mm; }
        .meta { width: 64mm; margin: 0; }
        .meta-row { display: grid; grid-template-columns: 32mm 32mm; min-height: 3.7mm; align-items: center; font-size: 10.5px; font-family: ${fontBold}; font-weight: 700; }
        .meta-label { background: #002060; color: #fff; text-align: right; padding: 0.35mm 1.5mm; }
        .meta-value { background: #ff3300; color: #fff; text-align: left; padding: 0.35mm 1.5mm; }
        .meta-row.vendor .meta-label, .meta-row.vendor .meta-value { background: #d9d9d9; color: #111827; }
        .logo { width: 25mm; height: 25mm; object-fit: contain; margin: 0; }
        table { width: 132mm; margin: 0 auto; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
        th { background: #d9d9d9; color: #111827; font-size: 12px; font-family: ${fontSemi}; font-weight: 600; text-align: center; padding: 0.45mm 1.2mm; border: none; }
        td { text-align: center; padding: 0.6mm 1.2mm; border: none; font-size: 13px; }
        td.money { white-space: nowrap; }
        .total-label { text-align: right; font-size: 13px; font-family: ${fontSemi}; font-weight: 600; }
        .total-value { background: #ff3300; color: #fff; font-size: 13px; font-family: ${fontBold}; font-weight: 700; white-space: nowrap; }
        .footer-note { margin-top: 8mm; color: #4b5563; font-size: 10px; }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="top">
          <div class="meta">
            <div class="meta-row"><div class="meta-label">TIENDA</div><div class="meta-value">${this.escapeHtml(tienda)}</div></div>
            <div class="meta-row"><div class="meta-label">MES</div><div class="meta-value">${this.escapeHtml(MONTH_NAMES[safeMonth - 1])}</div></div>
            <div class="meta-row vendor"><div class="meta-label">VENDEDOR</div><div class="meta-value">${this.escapeHtml(vendedor)}</div></div>
            <div class="meta-row"><div class="meta-label">META MES</div><div class="meta-value">${this.formatCurrency(metaMes)}</div></div>
            <div class="meta-row"><div class="meta-label">PROMEDIO DIARIO</div><div class="meta-value">${this.formatCurrency(promedioDiario)}</div></div>
            <div class="meta-row"><div class="meta-label">REPORTE No.</div><div class="meta-value">${this.escapeHtml(reporteNo)}</div></div>
          </div>
          ${logo ? `<img class="logo" src="${logo}" alt="Uniforma" />` : ''}
        </div>

        <table>
          <colgroup>
            <col style="width: 18%;" />
            <col style="width: 28%;" />
            <col style="width: 28%;" />
            <col style="width: 26%;" />
          </colgroup>
          <thead>
            <tr><th>FECHA</th><th>DIA</th><th>VENTA DIARIA</th><th>PORCENTAJE</th></tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) => `<tr><td>${row.day}</td><td>${this.escapeHtml(row.weekday)}</td><td class="money">${this.formatCurrency(row.ventaDiaria)}</td><td>${this.formatPercent(metaMes > 0 ? (Number(row.ventaDiaria || 0) / metaMes) * 100 : 0)}</td></tr>`,
              )
              .join('')}
            <tr><td></td><td class="total-label">${quincenaLabel}</td><td class="total-value">${this.formatCurrency(totalVenta)}</td><td class="total-value">${this.formatPercent(totalPorcentaje)}</td></tr>
          </tbody>
        </table>
        <div class="footer-note">Generado desde Uniforma el ${this.formatGeneratedAt()}.</div>
      </div>
    </body>
  </html>`;
  }

  private buildDailyReportPrintHtml(fecha: string, reporteData: any) {
    const capitalRows = this.asArray(reporteData?.capitalRows).filter((row) =>
      this.hasCapitalRowData(row),
    );
    const departamentoRows = this.asArray(reporteData?.departamentoRows).filter(
      (row) => this.hasDepartamentoRowData(row),
    );
    const tiendaRows = this.getTiendaRowsFromReport({
      ...reporteData,
      fecha,
    }).filter((row) => this.hasTiendaRowData(row));
    const resumen = this.getDailyReportSummary(reporteData, 0);
    const generadoPor = reporteData?.generadoPor || '-';
    const liquidacionNo = reporteData?.liquidacionNo || '-';
    const logo = this.getReportPdfLogoDataUri();
    const fontFamily =
      '"Myriad Pro", "MyriadPro-Regular", "Myriad Pro Regular", "Aptos", "Segoe UI", Arial, Helvetica, sans-serif';
    const fontSemi =
      '"Myriad Pro Semibold", "Myriad Pro SemiBold", "MyriadPro-Semibold", "Myriad Pro", "Aptos SemiBold", "Segoe UI Semibold", "Segoe UI", Arial, Helvetica, sans-serif';
    const fontBold =
      '"Myriad Pro Bold", "MyriadPro-Bold", "Myriad Pro", "Aptos Bold", "Segoe UI Bold", "Segoe UI", Arial, Helvetica, sans-serif';
    const buildRows = (rows: string, colspan = 10) =>
      rows || `<tr><td colspan="${colspan}" class="empty">Sin datos</td></tr>`;
    const capitalTotals = this.getCapitalPdfRows(capitalRows).totals;
    const departamentoTotals =
      this.getDepartamentoPdfRows(departamentoRows).totals;
    const tiendaTotals = this.getTiendaPdfRows({
      ...reporteData,
      fecha,
    }).totals;

    return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Reporte diario ${this.escapeHtml(fecha)}</title>
      <style>
        @page { size: portrait; margin: 10mm; }
        html, body, .page, table, th, td, .section-title, .summary-box {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        body { font-family: ${fontFamily}; color: #111827; margin: 0; background: #fff; }
        .page { padding: 10px 12px 18px; }
        .header { display: flex; align-items: center; justify-content: flex-start; margin-bottom: 6px; }
        .brand { display: flex; align-items: center; }
        .brand img { width: 112px; height: 112px; object-fit: contain; }
        .top-info-row { position: relative; display: flex; align-items: flex-end; justify-content: flex-end; gap: 16px; width: 100%; margin: 4px 0 8px; min-height: 36px; }
        .top-meta-row { display: flex; justify-content: flex-end; margin-left: auto; width: 100%; }
        .report-meta { display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 4px; margin-left: auto; }
        .report-date { font-family: ${fontBold}; font-weight: 700; font-size: 10px; line-height: 1.1; width: 100%; text-align: center; }
        .report-user { display: inline-block; background-color: #1f3f87; color: #fff; padding: 4px 24px; text-align: center; text-transform: uppercase; font-family: ${fontBold}; font-weight: 700; font-size: 10px; line-height: 1.1; border: none; }
        .liquidacion-wrap { margin: 0; text-align: center; position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); }
        .liquidacion-row { background-color: #d90000; color: #fff; padding: 4px 10px; font-size: 11px; display: inline-block; font-family: ${fontBold}; font-weight: 700; }
        .section-title, th, .summary-box h3, .summary-label, .summary-value { font-family: ${fontBold}; font-weight: 700; }
        .section { margin-top: 10px; }
        .section-title { background-color: #d90000; color: #fff; padding: 3px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
        thead tr:last-child th { border-bottom: 3px solid #fff !important; }
        tbody tr:first-child td { box-shadow: inset 0 1px 0 #000; }
        th, td { border: 1px solid #000; padding: 2px 5px; vertical-align: middle; text-align: center; word-break: break-word; background-color: #fff; }
        th { background-color: #1f3f87; color: #fff; text-align: center; text-transform: uppercase; border-left: 1px solid #1f3f87; border-right: 1px solid #1f3f87; border-top: none; }
        th:first-child { border-left: none; }
        th:last-child { border-right: none; }
        .compact-table th, .tienda-table th { white-space: nowrap; font-size: 7.6px; padding: 3px 2px; letter-spacing: -0.05px; }
        .tienda-table th { font-size: 7.4px; padding-left: 2px; padding-right: 2px; }
        .compact-table td, .tienda-table td { font-size: 8.5px; }
        .block-total-cell { font-family: ${fontBold}; font-weight: 700; color: #fff; text-align: center; white-space: nowrap; padding: 2px 6px; border: none !important; }
        .block-total-blue { background-color: #1f3f87 !important; }
        .block-total-red { background-color: #d90000 !important; }
        .block-total-empty { background-color: #fff !important; border: none !important; }
        .block-total-spacer td { height: 3px; padding: 0; background-color: #fff !important; border: none !important; }
        .aligned-grid col:nth-child(1) { width: 10%; }
        .aligned-grid col:nth-child(2) { width: 6%; }
        .aligned-grid col:nth-child(3) { width: 11.5%; }
        .aligned-grid col:nth-child(4) { width: 12.5%; }
        .aligned-grid col:nth-child(5) { width: 9.5%; }
        .aligned-grid col:nth-child(6) { width: 9%; }
        .aligned-grid col:nth-child(7) { width: 8.5%; }
        .aligned-grid col:nth-child(8) { width: 9%; }
        .aligned-grid col:nth-child(9) { width: 10.5%; }
        .aligned-grid col:nth-child(10) { width: 13.5%; }
        .tienda-grid col:nth-child(1) { width: 9.25%; }
        .tienda-grid col:nth-child(2) { width: 5.5%; }
        .tienda-grid col:nth-child(3) { width: 9%; }
        .tienda-grid col:nth-child(4) { width: 9%; }
        .tienda-grid col:nth-child(5) { width: 7.5%; }
        .tienda-grid col:nth-child(6) { width: 7%; }
        .tienda-grid col:nth-child(7) { width: 7%; }
        .tienda-grid col:nth-child(8) { width: 7.5%; }
        .tienda-grid col:nth-child(9) { width: 9%; }
        .tienda-grid col:nth-child(10) { width: 8%; }
        .tienda-grid col:nth-child(11) { width: 8%; }
        .tienda-grid col:nth-child(12) { width: 6.375%; }
        .tienda-grid col:nth-child(13) { width: 6.375%; }
        .obs-span, td.obs-cell { text-align: left; white-space: normal; overflow-wrap: anywhere; word-break: normal; }
        .obs-span { padding-left: 8px; padding-right: 8px; }
        td.date-cell, td.nowrap-cell, .tienda-table td:first-child { white-space: nowrap; word-break: normal; overflow-wrap: normal; }
        td.num { text-align: center; white-space: nowrap; }
        td.center { text-align: center; }
        td.empty { text-align: center; color: #6b7280; padding: 10px 0; }
        .summary-grid { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 36px; width: 50%; min-width: 320px; }
        .summary-box { padding: 0; box-sizing: border-box; overflow: visible; }
        .summary-box h3 { margin: 0; padding: 3px 10px; font-size: 10px; text-transform: uppercase; text-align: center; color: #fff; background-color: #1f3f87; border-bottom: none; border: none; }
        .summary-spacer { height: 3px; background-color: #fff; border: none; }
        .summary-row { display: flex; justify-content: space-between; gap: 16px; padding: 3px 10px; border-left: 1px solid #000; border-right: 1px solid #000; border-top: 1px solid #000; font-size: 10px; background-color: #fff; text-transform: uppercase; }
        .summary-row:first-of-type { border-top: none; }
        .summary-row.before-total { border-bottom: 1px solid #000; }
        .summary-row.total { border: none; font-size: 10px; color: #fff; background-color: #d90000; font-family: ${fontBold}; font-weight: 700; }
        .footer-note { margin-top: 8px; font-size: 10px; color: #4b5563; }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="header"><div class="brand">${logo ? `<img src="${logo}" alt="Uniforma" />` : ''}</div></div>
        <div class="top-info-row">
          <div class="liquidacion-wrap"><div class="liquidacion-row"><span>LIQUIDACION No.:</span> <span>${this.escapeHtml(liquidacionNo)}</span></div></div>
          <div class="top-meta-row"><div class="report-meta"><div class="report-date">${this.formatDisplayDate(fecha)}</div><div class="report-user">${this.escapeHtml(generadoPor)}</div></div></div>
        </div>
        ${this.buildPrintCapitalSection(capitalRows, capitalTotals, buildRows)}
        ${this.buildPrintDepartamentoSection(departamentoRows, departamentoTotals, buildRows)}
        ${this.buildPrintTiendaSection(tiendaRows, tiendaTotals, buildRows)}
        <div class="summary-grid"><div class="summary-box">
          <h3>Resumen</h3><div class="summary-spacer"></div>
          <div class="summary-row"><span class="summary-label">CAPITAL</span><span class="summary-value">${this.formatCurrency(resumen.capital)}</span></div>
          <div class="summary-row"><span class="summary-label">DEPARTAMENTO</span><span class="summary-value">${this.formatCurrency(resumen.departamento)}</span></div>
          <div class="summary-row before-total"><span class="summary-label">TIENDA</span><span class="summary-value">${this.formatCurrency(resumen.tienda)}</span></div>
          <div class="summary-spacer"></div>
          <div class="summary-row total"><span class="summary-label">TOTAL</span><span class="summary-value">${this.formatCurrency(resumen.total)}</span></div>
        </div></div>
        <div class="footer-note">Generado desde Uniforma el ${this.formatGeneratedAt()}.</div>
      </div>
    </body>
  </html>`;
  }

  private buildPrintCapitalSection(
    rows: any[],
    totals: Record<number, string>,
    buildRows: (rows: string, colspan?: number) => string,
  ) {
    return `<div class="section">
      <div class="section-title">Capital / Mensajero</div>
      <table class="compact-table aligned-grid">
        <colgroup><col /><col /><col /><col /><col /><col /><col /><col /><col /><col /></colgroup>
        <thead><tr><th>Fecha</th><th>Envio</th><th>Transf.</th><th>Aut. Transf.</th><th>Deposito</th><th>Boleta</th><th>Banco</th><th>Efectivo</th><th>Total</th><th>Observaciones</th></tr></thead>
        <tbody>
          ${buildRows(
            rows
              .map((row) => {
                const total =
                  Number(row?.transferencia || 0) +
                  Number(row?.deposito || 0) +
                  Number(row?.efectivo || 0);
                return `<tr><td class="center date-cell">${this.formatDisplayDate(row?.fecha)}</td><td>${this.escapeHtml(row?.envio || '')}</td><td class="num">${this.formatCurrency(row?.transferencia)}</td><td>${this.escapeHtml(row?.autorizacion || '')}</td><td class="num">${this.formatCurrency(row?.deposito)}</td><td class="nowrap-cell">${this.escapeHtml(row?.boleta || '')}</td><td>${this.escapeHtml(row?.banco || '')}</td><td class="num">${this.formatCurrency(row?.efectivo)}</td><td class="num">${this.formatCurrency(total)}</td><td class="obs-cell">${this.escapeHtml(row?.observaciones || '')}</td></tr>`;
              })
              .join(''),
          )}
          <tr class="block-total-spacer"><td colspan="10"></td></tr>
          <tr><td class="block-total-empty"></td><td class="block-total-empty"></td><td class="block-total-cell block-total-blue">${totals[2] || ''}</td><td class="block-total-empty"></td><td class="block-total-cell block-total-blue">${totals[4] || ''}</td><td class="block-total-empty"></td><td class="block-total-empty"></td><td class="block-total-cell block-total-blue">${totals[7] || ''}</td><td class="block-total-cell block-total-red">${totals[8] || ''}</td><td class="block-total-empty"></td></tr>
        </tbody>
      </table>
    </div>`;
  }

  private buildPrintDepartamentoSection(
    rows: any[],
    totals: Record<number, string>,
    buildRows: (rows: string, colspan?: number) => string,
  ) {
    return `<div class="section">
      <div class="section-title">Departamentos / Cargo Expreso</div>
      <table class="compact-table aligned-grid">
        <colgroup><col /><col /><col /><col /><col /><col /><col /><col /><col /><col /></colgroup>
        <thead><tr><th>Fecha</th><th>Envio</th><th>Transf.</th><th>Aut. Transf.</th><th>Deposito</th><th>Boleta</th><th>Banco</th><th>Total</th><th colspan="2">Observaciones</th></tr></thead>
        <tbody>
          ${buildRows(
            rows
              .map((row) => {
                const total =
                  Number(row?.transferencia || 0) +
                  Number(row?.deposito || 0);
                return `<tr><td class="center date-cell">${this.formatDisplayDate(row?.fecha)}</td><td>${this.escapeHtml(row?.envio || '')}</td><td class="num">${this.formatCurrency(row?.transferencia)}</td><td>${this.escapeHtml(row?.autorizacion || '')}</td><td class="num">${this.formatCurrency(row?.deposito)}</td><td class="nowrap-cell">${this.escapeHtml(row?.boleta || '')}</td><td>${this.escapeHtml(row?.banco || '')}</td><td class="num">${this.formatCurrency(total)}</td><td class="obs-span" colspan="2">${this.escapeHtml(row?.observaciones || '')}</td></tr>`;
              })
              .join(''),
          )}
          <tr class="block-total-spacer"><td colspan="10"></td></tr>
          <tr><td class="block-total-empty"></td><td class="block-total-empty"></td><td class="block-total-cell block-total-blue">${totals[2] || ''}</td><td class="block-total-empty"></td><td class="block-total-cell block-total-blue">${totals[4] || ''}</td><td class="block-total-empty"></td><td class="block-total-empty"></td><td class="block-total-cell block-total-red">${totals[7] || ''}</td><td class="block-total-empty" colspan="2"></td></tr>
        </tbody>
      </table>
    </div>`;
  }

  private buildPrintTiendaSection(
    rows: any[],
    totals: Record<number, string>,
    buildRows: (rows: string, colspan?: number) => string,
  ) {
    return `<div class="section">
      <div class="section-title">Tienda</div>
      <table class="tienda-table tienda-grid">
        <colgroup><col /><col /><col /><col /><col /><col /><col /><col /><col /><col /><col /><col /><col /></colgroup>
        <thead><tr><th>Fecha</th><th>Recibo</th><th>Transf.</th><th>Aut. Transf.</th><th>Deposito</th><th>Boleta</th><th>Banco</th><th>Tarjeta</th><th>Aut. Tarj.</th><th>Efectivo</th><th>Total</th><th colspan="2">Observaciones</th></tr></thead>
        <tbody>
          ${buildRows(
            rows
              .map(
                (row) =>
                  `<tr><td class="center date-cell">${this.formatDisplayDate(row?.fecha)}</td><td>${this.escapeHtml(row?.recibo || '')}</td><td class="num">${this.formatCurrency(row?.transferencia)}</td><td>${this.escapeHtml(row?.autorizacionTransferencia || '')}</td><td class="num">${this.formatCurrency(row?.deposito)}</td><td class="nowrap-cell">${this.escapeHtml(row?.boleta || '')}</td><td>${this.escapeHtml(row?.banco || '')}</td><td class="num">${this.formatCurrency(row?.tarjeta)}</td><td>${this.escapeHtml(row?.autorizacionTarjeta || '')}</td><td class="num">${this.formatCurrency(row?.efectivo)}</td><td class="num">${this.formatCurrency(this.getTiendaRowTotal(row))}</td><td class="obs-span" colspan="2">${this.escapeHtml(row?.observaciones || '')}</td></tr>`,
              )
              .join(''),
            13,
          )}
          <tr class="block-total-spacer"><td colspan="13"></td></tr>
          <tr><td class="block-total-empty"></td><td class="block-total-empty"></td><td class="block-total-cell block-total-blue">${totals[2] || ''}</td><td class="block-total-empty"></td><td class="block-total-cell block-total-blue">${totals[4] || ''}</td><td class="block-total-empty"></td><td class="block-total-empty"></td><td class="block-total-cell block-total-blue">${totals[7] || ''}</td><td class="block-total-empty"></td><td class="block-total-cell block-total-blue">${totals[9] || ''}</td><td class="block-total-cell block-total-red">${totals[10] || ''}</td><td class="block-total-empty" colspan="2"></td></tr>
        </tbody>
      </table>
    </div>`;
  }

  private drawReportSection(
    doc: PDFKit.PDFDocument,
    title: string,
    headers: string[],
    rows: Array<Array<string>>,
    totals: Record<number, string>,
  ) {
    if (doc.y > 690) {
      doc.addPage();
      doc.y = 36;
    }

    const startX = 34;
    const tableWidth = 527;
    const widths =
      headers.length === 10
        ? [45, 36, 60, 64, 52, 52, 52, 52, 52, 62]
        : [45, 36, 62, 66, 54, 54, 54, 56, 100];

    doc
      .rect(startX, doc.y, tableWidth, 16)
      .fill('#d90000')
      .fillColor('#ffffff')
      .fontSize(8)
      .text(title.toUpperCase(), startX, doc.y + 4, {
        width: tableWidth,
        align: 'center',
      });
    doc.y += 20;

    this.drawTableRow(doc, headers, widths, startX, {
      fill: '#1f3f87',
      color: '#ffffff',
      fontSize: 6.4,
      height: 20,
    });

    const visibleRows = rows.length
      ? rows
      : [['Sin datos', ...headers.slice(1).map(() => '')]];
    visibleRows.forEach((row) => {
      this.drawTableRow(doc, row, widths, startX, {
        fill: '#ffffff',
        color: '#111827',
        fontSize: 6.4,
        height: 18,
      });
    });

    if (rows.length > 0) {
      const totalRow = headers.map((_, index) => totals[index] || '');
      this.drawTableRow(doc, totalRow, widths, startX, {
        fill: '#ffffff',
        color: '#ffffff',
        fontSize: 6.4,
        height: 18,
        totals,
      });
    }

    doc.y += 10;
  }

  private drawTableRow(
    doc: PDFKit.PDFDocument,
    values: string[],
    widths: number[],
    startX: number,
    options: {
      fill: string;
      color: string;
      fontSize: number;
      height: number;
      totals?: Record<number, string>;
    },
  ) {
    let x = startX;
    const y = doc.y;
    values.forEach((value, index) => {
      const isTotalCell = Boolean(options.totals?.[index]);
      const fill = isTotalCell
        ? index === 7 || index === 8
          ? '#d90000'
          : '#1f3f87'
        : options.fill;
      doc.rect(x, y, widths[index], options.height).fillAndStroke(fill, '#000000');
      doc
        .fillColor(isTotalCell ? '#ffffff' : options.color)
        .fontSize(options.fontSize)
        .text(value || '', x + 2, y + 5, {
          width: widths[index] - 4,
          align: 'center',
          ellipsis: true,
        });
      x += widths[index];
    });
    doc.y = y + options.height;
  }

  private drawReportSummary(doc: PDFKit.PDFDocument, resumen: any) {
    const x = 34;
    const y = doc.y + 12;
    const w = 270;
    doc.rect(x, y, w, 16).fill('#1f3f87');
    doc.fillColor('#ffffff').fontSize(8).text('RESUMEN', x, y + 4, {
      width: w,
      align: 'center',
    });

    const rows = [
      ['CAPITAL', this.formatCurrency(resumen.capital)],
      ['DEPARTAMENTO', this.formatCurrency(resumen.departamento)],
      ['TIENDA', this.formatCurrency(resumen.tienda)],
      ['TOTAL', this.formatCurrency(resumen.total)],
    ];
    let rowY = y + 20;
    rows.forEach(([label, value], index) => {
      const isTotal = index === rows.length - 1;
      doc
        .rect(x, rowY, w, 18)
        .fillAndStroke(isTotal ? '#d90000' : '#ffffff', isTotal ? '#d90000' : '#000000');
      doc
        .fillColor(isTotal ? '#ffffff' : '#111827')
        .fontSize(8)
        .text(label, x + 10, rowY + 5, { width: 120 })
        .text(value, x + 145, rowY + 5, { width: 115, align: 'right' });
      rowY += 18;
      if (index === 2) {
        rowY += 4;
      }
    });
    doc.y = rowY;
  }

  private getCapitalPdfRows(rows: unknown) {
    const rowsWithData = this.asArray(rows).filter((row) =>
      this.hasCapitalRowData(row),
    );
    const totals = {
      2: this.formatCurrency(
        rowsWithData.reduce(
          (sum, row) => sum + Number(row?.transferencia || 0),
          0,
        ),
      ),
      4: this.formatCurrency(
        rowsWithData.reduce((sum, row) => sum + Number(row?.deposito || 0), 0),
      ),
      7: this.formatCurrency(
        rowsWithData.reduce((sum, row) => sum + Number(row?.efectivo || 0), 0),
      ),
      8: this.formatCurrency(
        rowsWithData.reduce(
          (sum, row) =>
            sum +
            Number(row?.transferencia || 0) +
            Number(row?.deposito || 0) +
            Number(row?.efectivo || 0),
          0,
        ),
      ),
    };

    return {
      rows: rowsWithData.map((row) => [
        this.formatDisplayDate(row?.fecha),
        row?.envio || '',
        this.formatCurrency(row?.transferencia),
        row?.autorizacion || '',
        this.formatCurrency(row?.deposito),
        row?.boleta || '',
        row?.banco || '',
        this.formatCurrency(row?.efectivo),
        this.formatCurrency(
          Number(row?.transferencia || 0) +
            Number(row?.deposito || 0) +
            Number(row?.efectivo || 0),
        ),
        row?.observaciones || '',
      ]),
      totals,
    };
  }

  private getDepartamentoPdfRows(rows: unknown) {
    const rowsWithData = this.asArray(rows).filter((row) =>
      this.hasDepartamentoRowData(row),
    );
    const totals = {
      2: this.formatCurrency(
        rowsWithData.reduce(
          (sum, row) => sum + Number(row?.transferencia || 0),
          0,
        ),
      ),
      4: this.formatCurrency(
        rowsWithData.reduce((sum, row) => sum + Number(row?.deposito || 0), 0),
      ),
      7: this.formatCurrency(
        rowsWithData.reduce(
          (sum, row) =>
            sum + Number(row?.transferencia || 0) + Number(row?.deposito || 0),
          0,
        ),
      ),
    };

    return {
      rows: rowsWithData.map((row) => [
        this.formatDisplayDate(row?.fecha),
        row?.envio || '',
        this.formatCurrency(row?.transferencia),
        row?.autorizacion || '',
        this.formatCurrency(row?.deposito),
        row?.boleta || '',
        row?.banco || '',
        this.formatCurrency(
          Number(row?.transferencia || 0) + Number(row?.deposito || 0),
        ),
        row?.observaciones || '',
      ]),
      totals,
    };
  }

  private getTiendaPdfRows(reporteData: any) {
    const rowsWithData = this.getTiendaRowsFromReport(reporteData).filter(
      (row) => this.hasTiendaRowData(row),
    );
    const totals = {
      2: this.formatCurrency(
        rowsWithData.reduce(
          (sum, row) => sum + Number(row?.transferencia || 0),
          0,
        ),
      ),
      4: this.formatCurrency(
        rowsWithData.reduce((sum, row) => sum + Number(row?.deposito || 0), 0),
      ),
      7: this.formatCurrency(
        rowsWithData.reduce((sum, row) => sum + Number(row?.tarjeta || 0), 0),
      ),
      9: this.formatCurrency(
        rowsWithData.reduce((sum, row) => sum + Number(row?.efectivo || 0), 0),
      ),
      10: this.formatCurrency(
        rowsWithData.reduce((sum, row) => sum + this.getTiendaRowTotal(row), 0),
      ),
    };

    return {
      rows: rowsWithData.map((row) => [
        this.formatDisplayDate(row?.fecha),
        row?.recibo || '',
        this.formatCurrency(row?.transferencia),
        row?.autorizacionTransferencia || '',
        this.formatCurrency(row?.deposito),
        row?.boleta || '',
        row?.banco || '',
        this.formatCurrency(row?.tarjeta),
        row?.autorizacionTarjeta || '',
        this.formatCurrency(row?.efectivo),
        this.formatCurrency(this.getTiendaRowTotal(row)),
        row?.observaciones || '',
      ]),
      totals,
    };
  }

  private hasCapitalRowData(row: any) {
    return Boolean(
      `${row?.envio || ''}`.trim() ||
        `${row?.autorizacion || ''}`.trim() ||
        `${row?.boleta || ''}`.trim() ||
        `${row?.banco || ''}`.trim() ||
        `${row?.observaciones || ''}`.trim() ||
        Number(row?.transferencia || 0) > 0 ||
        Number(row?.deposito || 0) > 0 ||
        Number(row?.efectivo || 0) > 0,
    );
  }

  private hasDepartamentoRowData(row: any) {
    return Boolean(
      `${row?.envio || ''}`.trim() ||
        `${row?.autorizacion || ''}`.trim() ||
        `${row?.boleta || ''}`.trim() ||
        `${row?.banco || ''}`.trim() ||
        `${row?.observaciones || ''}`.trim() ||
        Number(row?.transferencia || 0) > 0 ||
        Number(row?.deposito || 0) > 0,
    );
  }

  private hasTiendaRowData(row: any) {
    return Boolean(
      `${row?.recibo || ''}`.trim() ||
        `${row?.autorizacionTransferencia || ''}`.trim() ||
        `${row?.autorizacionTarjeta || ''}`.trim() ||
        `${row?.observaciones || ''}`.trim() ||
        Number(row?.transferencia || 0) > 0 ||
        Number(row?.deposito || 0) > 0 ||
        Number(row?.tarjeta || 0) > 0 ||
        Number(row?.efectivo || 0) > 0 ||
        Number(row?.total || 0) > 0,
    );
  }

  private formatDisplayDate(value: string) {
    if (!value) {
      return '';
    }
    const [year, month, day] = value.split('-');
    if (!year || !month || !day) {
      return value;
    }
    return `${day}/${month}/${year}`;
  }

  private getFortnightlyRows(
    year: number,
    month: number,
    quincena: '1' | '2',
  ) {
    const lastDay = new Date(year, month, 0).getDate();
    const start = quincena === '1' ? 1 : 16;
    const end = quincena === '1' ? 15 : lastDay;

    return Array.from({ length: end - start + 1 }, (_, index) => start + index)
      .map((day) => {
        const date = new Date(year, month - 1, day);
        return {
          day,
          weekday: WEEKDAY_NAMES[date.getDay()],
        };
      })
      .filter((row) => row.weekday !== 'DOMINGO');
  }

  private getMonthlyRows(year: number, month: number) {
    const lastDay = new Date(year, month, 0).getDate();

    return Array.from({ length: lastDay }, (_, index) => index + 1)
      .map((day) => {
        const date = new Date(year, month - 1, day);
        return {
          day,
          weekday: WEEKDAY_NAMES[date.getDay()],
        };
      })
      .filter((row) => row.weekday !== 'DOMINGO');
  }

  private getFortnightlyPeriodLabel(reporteData: any) {
    const month = Number(reporteData?.month || new Date().getMonth() + 1);
    const safeMonth = Math.min(Math.max(month, 1), 12);
    const year = Number(reporteData?.year || new Date().getFullYear());
    const quincena = reporteData?.quincena === '1' ? '1RA' : '2DA';
    return `${quincena} QUINCENA ${MONTH_NAMES[safeMonth - 1]} ${year}`;
  }

  private formatCurrency(value: unknown) {
    const amount = Number(value || 0);
    const sign = amount < 0 ? '-' : '';
    const [integer, decimals] = Math.abs(amount).toFixed(2).split('.');
    const withCommas = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `Q ${sign}${withCommas}.${decimals}`;
  }

  private formatPercent(value: unknown) {
    return `${Number(value || 0).toFixed(2)}%`;
  }

  private escapeHtml(value: string) {
    return `${value}`
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private formatFromAddress(value: string) {
    const raw = `${value || ''}`.trim() || 'noreply@uniforma.com';
    if (raw.includes('<') && raw.includes('>')) {
      return raw;
    }
    const displayName =
      process.env.MAIL_FROM_NAME || process.env.RESEND_FROM_NAME || 'Uniforma Guatemala';
    return `"${displayName.replace(/"/g, '')}" <${raw}>`;
  }

  private async sendMail(
    to: string[],
    subject: string,
    html: string,
    config: any,
    fecha: string,
    total: number,
    reporteData?: any,
    options?: {
      pdfFilename?: string;
      pdfBuilder?: () => Promise<Buffer>;
      templateVariables?: Record<string, unknown>;
      logLabel?: string;
    },
  ) {
    const from = this.formatFromAddress(
      config.resendFrom ||
        config.smtpFrom ||
        process.env.RESEND_FROM ||
        process.env.MAIL_FROM ||
        'noreply@uniforma.com',
    );
    const toAddresses = to.join(', ');
    const resendApiKey = config.resendApiKey || process.env.RESEND_API_KEY;
    const useResend = Boolean(
      (config.resendEnabled ||
        process.env.RESEND_ENABLED === 'true' ||
        process.env.RESEND_API_KEY) &&
      resendApiKey,
    );

    if (useResend) {
      this.logger.log(
        `Enviando correo de ${options?.logLabel || 'reporte diario'} con Resend`,
      );
      const resend = new Resend(resendApiKey);
      const pdf = options?.pdfBuilder
        ? await options.pdfBuilder()
        : await this.buildDailyReportPdf(fecha, reporteData);
      const logo = this.getLogoBuffer();
      const payload: any = {
        from,
        to,
        subject,
        attachments: [
          {
            filename: options?.pdfFilename || `reporte-diario-${fecha}.pdf`,
            content: pdf.toString('base64'),
            contentType: 'application/pdf',
          },
          ...(logo
            ? [
                {
                  filename: 'uniforma-logo.png',
                  content: logo.toString('base64'),
                  contentType: 'image/png',
                  contentId: 'uniforma-logo',
                },
              ]
            : []),
        ],
      };

      if (config.resendTemplateId) {
        payload.template = {
          id: config.resendTemplateId,
          variables: options?.templateVariables || {
            fecha,
            total,
            totalFormatted: `Q ${total.toFixed(2)}`,
          },
        };
      } else {
        payload.html = html;
      }

      const response = await resend.emails.send(payload);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return;
    }

    const host = config.smtpHost || process.env.MAIL_HOST || 'smtp.gmail.com';
    const port = Number(config.smtpPort || process.env.MAIL_PORT || 587);
    const user = config.smtpUser || process.env.MAIL_USER;
    const pass = config.smtpPass || process.env.MAIL_PASS;

    if (!user || !pass) {
      throw new Error(
        'SMTP no configurado correctamente: faltan MAIL_USER o MAIL_PASS. Si quieres usar Resend, asegúrate de tener RESEND_API_KEY disponible en el entorno y activar Resend en la configuración.',
      );
    }

    this.logger.log(
      `Enviando correo de ${options?.logLabel || 'reporte diario'} con SMTP`,
    );
    const pdf = options?.pdfBuilder
      ? await options.pdfBuilder()
      : await this.buildDailyReportPdf(fecha, reporteData);
    const logo = this.getLogoBuffer();
    const transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
    });

    await transporter.sendMail({
      from,
      to: toAddresses,
      subject,
      html,
      attachments: [
        {
          filename: options?.pdfFilename || `reporte-diario-${fecha}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        },
        ...(logo
          ? [
              {
                filename: 'uniforma-logo.png',
                content: logo,
                contentType: 'image/png',
                cid: 'uniforma-logo',
              },
            ]
          : []),
      ],
    });
  }
}

