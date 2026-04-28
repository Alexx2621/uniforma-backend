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

@Injectable()
export class ReportesService {
  private readonly logger = new Logger(ReportesService.name);

  constructor(private configService: NotificacionesConfigService) {}

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
    const ventasSnapshotRows = this.asArray(reporteData?.ventasSnapshot).map(
      (venta) => {
        const metodo = `${venta?.metodoPago || ''}`.trim().toLowerCase();
        const referencia = `${venta?.pagos?.[0]?.referencia || ''}`.trim();
        const total = Number(venta?.total || 0);

        return {
          fecha: reporteData?.fecha || '',
          recibo: `V-${venta?.id || ''}`,
          transferencia: metodo === 'transferencia' ? total : 0,
          tarjeta:
            metodo === 'tarjeta' || metodo === 'visalink' ? total : 0,
          efectivo: metodo === 'efectivo' ? total : 0,
          total,
          observaciones: referencia,
        };
      },
    );

    return [
      ...ventasSnapshotRows,
      ...this.asArray(reporteData?.tiendaManualRows),
    ];
  }

  private getTiendaRowTotal(row: any) {
    return (
      Number(row?.total || 0) ||
      Number(row?.transferencia || 0) +
        Number(row?.tarjeta || 0) +
        Number(row?.efectivo || 0)
    );
  }

  private asArray(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
  }

  private getLogoDataUri() {
    const logoPath = join(
      process.cwd(),
      '..',
      'uniforma-frontend',
      'src',
      'assets',
      'uniforma-logo.png',
    );
    if (!existsSync(logoPath)) {
      return '';
    }

    const base64 = readFileSync(logoPath).toString('base64');
    return `data:image/png;base64,${base64}`;
  }

  private getLogoBuffer() {
    const logoPath = join(
      process.cwd(),
      '..',
      'uniforma-frontend',
      'src',
      'assets',
      'uniforma-logo.png',
    );
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
    const logo = this.getLogoDataUri();
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
        th { background-color: #1f3f87; color: #fff; text-align: center; text-transform: uppercase; border-left: none; border-right: none; border-top: none; }
        .compact-table th, .tienda-table th { white-space: nowrap; font-size: 8.5px; padding: 3px 4px; }
        .compact-table td, .tienda-table td { font-size: 8.5px; }
        .block-total-cell { font-family: ${fontBold}; font-weight: 700; color: #fff; text-align: center; white-space: nowrap; padding: 2px 6px; border: none !important; }
        .block-total-blue { background-color: #1f3f87 !important; }
        .block-total-red { background-color: #d90000 !important; }
        .block-total-empty { background-color: #fff !important; border: none !important; }
        .block-total-spacer td { height: 3px; padding: 0; background-color: #fff !important; border: none !important; }
        .aligned-grid col:nth-child(1) { width: 8.5%; }
        .aligned-grid col:nth-child(2) { width: 6.5%; }
        .aligned-grid col:nth-child(3) { width: 11%; }
        .aligned-grid col:nth-child(4) { width: 12%; }
        .aligned-grid col:nth-child(5) { width: 9.5%; }
        .aligned-grid col:nth-child(6) { width: 9.5%; }
        .aligned-grid col:nth-child(7) { width: 9.5%; }
        .aligned-grid col:nth-child(8) { width: 9.5%; }
        .aligned-grid col:nth-child(9) { width: 11%; }
        .aligned-grid col:nth-child(10) { width: 13%; }
        .obs-span { padding-left: 8px; padding-right: 8px; text-align: left; }
        td.obs-cell { text-align: left; }
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
        <div class="footer-note">Generado desde Uniforma el ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}.</div>
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
        <thead><tr><th>Fecha</th><th>Envio</th><th>Transferencia</th><th>Autorizacion</th><th>Deposito</th><th>Boleta</th><th>Banco</th><th>Efectivo</th><th>Total</th><th>Observaciones</th></tr></thead>
        <tbody>
          ${buildRows(
            rows
              .map((row) => {
                const total =
                  Number(row?.transferencia || 0) +
                  Number(row?.deposito || 0) +
                  Number(row?.efectivo || 0);
                return `<tr><td class="center">${this.formatDisplayDate(row?.fecha)}</td><td>${this.escapeHtml(row?.envio || '')}</td><td class="num">${this.formatCurrency(row?.transferencia)}</td><td>${this.escapeHtml(row?.autorizacion || '')}</td><td class="num">${this.formatCurrency(row?.deposito)}</td><td>${this.escapeHtml(row?.boleta || '')}</td><td>${this.escapeHtml(row?.banco || '')}</td><td class="num">${this.formatCurrency(row?.efectivo)}</td><td class="num">${this.formatCurrency(total)}</td><td class="obs-cell">${this.escapeHtml(row?.observaciones || '')}</td></tr>`;
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
        <thead><tr><th>Fecha</th><th>Envio</th><th>Transferencia</th><th>Autorizacion</th><th>Deposito</th><th>Boleta</th><th>Banco</th><th>Total</th><th colspan="2">Observaciones</th></tr></thead>
        <tbody>
          ${buildRows(
            rows
              .map((row) => {
                const total =
                  Number(row?.transferencia || 0) +
                  Number(row?.deposito || 0);
                return `<tr><td class="center">${this.formatDisplayDate(row?.fecha)}</td><td>${this.escapeHtml(row?.envio || '')}</td><td class="num">${this.formatCurrency(row?.transferencia)}</td><td>${this.escapeHtml(row?.autorizacion || '')}</td><td class="num">${this.formatCurrency(row?.deposito)}</td><td>${this.escapeHtml(row?.boleta || '')}</td><td>${this.escapeHtml(row?.banco || '')}</td><td class="num">${this.formatCurrency(total)}</td><td class="obs-span" colspan="2">${this.escapeHtml(row?.observaciones || '')}</td></tr>`;
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
      <table class="tienda-table aligned-grid">
        <colgroup><col /><col /><col /><col /><col /><col /><col /><col /><col /><col /></colgroup>
        <thead><tr><th>Fecha</th><th>Recibo</th><th>Transferencia</th><th>Autorizacion</th><th>Tarjeta</th><th>Autorizacion</th><th>Efectivo</th><th>Total</th><th colspan="2">Observaciones</th></tr></thead>
        <tbody>
          ${buildRows(
            rows
              .map(
                (row) =>
                  `<tr><td class="center">${this.formatDisplayDate(row?.fecha)}</td><td>${this.escapeHtml(row?.recibo || '')}</td><td class="num">${this.formatCurrency(row?.transferencia)}</td><td>${this.escapeHtml(row?.autorizacionTransferencia || '')}</td><td class="num">${this.formatCurrency(row?.tarjeta)}</td><td>${this.escapeHtml(row?.autorizacionTarjeta || '')}</td><td class="num">${this.formatCurrency(row?.efectivo)}</td><td class="num">${this.formatCurrency(this.getTiendaRowTotal(row))}</td><td class="obs-span" colspan="2">${this.escapeHtml(row?.observaciones || '')}</td></tr>`,
              )
              .join(''),
          )}
          <tr class="block-total-spacer"><td colspan="10"></td></tr>
          <tr><td class="block-total-empty"></td><td class="block-total-empty"></td><td class="block-total-cell block-total-blue">${totals[2] || ''}</td><td class="block-total-empty"></td><td class="block-total-cell block-total-blue">${totals[4] || ''}</td><td class="block-total-empty"></td><td class="block-total-cell block-total-blue">${totals[6] || ''}</td><td class="block-total-cell block-total-red">${totals[7] || ''}</td><td class="block-total-empty" colspan="2"></td></tr>
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
        rowsWithData.reduce((sum, row) => sum + Number(row?.tarjeta || 0), 0),
      ),
      6: this.formatCurrency(
        rowsWithData.reduce((sum, row) => sum + Number(row?.efectivo || 0), 0),
      ),
      7: this.formatCurrency(
        rowsWithData.reduce((sum, row) => sum + this.getTiendaRowTotal(row), 0),
      ),
    };

    return {
      rows: rowsWithData.map((row) => [
        this.formatDisplayDate(row?.fecha),
        row?.recibo || '',
        this.formatCurrency(row?.transferencia),
        row?.autorizacionTransferencia || '',
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

  private formatCurrency(value: unknown) {
    return `Q ${Number(value || 0).toFixed(2)}`;
  }

  private escapeHtml(value: string) {
    return `${value}`
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private async sendMail(
    to: string[],
    subject: string,
    html: string,
    config: any,
    fecha: string,
    total: number,
    reporteData?: any,
  ) {
    const from =
      config.resendFrom ||
      config.smtpFrom ||
      process.env.RESEND_FROM ||
      process.env.MAIL_FROM ||
      'noreply@uniforma.com';
    const toAddresses = to.join(', ');
    const resendApiKey = config.resendApiKey || process.env.RESEND_API_KEY;
    const useResend = Boolean(
      (config.resendEnabled ||
        process.env.RESEND_ENABLED === 'true' ||
        process.env.RESEND_API_KEY) &&
      resendApiKey,
    );

    if (useResend) {
      this.logger.log('Enviando correo de reporte diario con Resend');
      const resend = new Resend(resendApiKey);
      const pdf = await this.buildDailyReportPdf(fecha, reporteData);
      const logo = this.getLogoBuffer();
      const payload: any = {
        from,
        to,
        subject,
        attachments: [
          {
            filename: `reporte-diario-${fecha}.pdf`,
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
          variables: {
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

    this.logger.log('Enviando correo de reporte diario con SMTP');
    const pdf = await this.buildDailyReportPdf(fecha, reporteData);
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
          filename: `reporte-diario-${fecha}.pdf`,
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
