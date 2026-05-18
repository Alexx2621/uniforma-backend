import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import PDFDocument from 'pdfkit';

import { InventarioService } from './inventario.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('inventario')
export class InventarioController {
  constructor(private readonly service: InventarioService) {}

  @Get('reporte')
  @UseGuards(JwtAuthGuard)
  getReporte(@Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.reporteInventario(req.user);
  }

  @Get('resumen')
  @UseGuards(JwtAuthGuard)
  getResumen(@Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.resumenPorProducto(req.user);
  }

  @Get(':bodegaId/:productoId')
  async getStock(@Param('bodegaId') bodegaId: string, @Param('productoId') productoId: string) {
    const stock = await this.service.obtenerStockActual(Number(bodegaId), Number(productoId));
    return { stock };
  }

  @Get('reporte/excel')
  @UseGuards(JwtAuthGuard)
  async exportExcel(@Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }, @Res() res: Response) {
    const data = await this.service.reporteInventario(req.user);

    const Excel = require('exceljs');
    const workbook = new Excel.Workbook();
    const sheet = workbook.addWorksheet('Inventario');

    sheet.columns = [
      { header: 'Codigo', key: 'codigo' },
      { header: 'Producto', key: 'producto' },
      { header: 'Talla', key: 'talla' },
      { header: 'Color', key: 'color' },
      { header: 'Tela', key: 'tela' },
      { header: 'Bodega', key: 'bodega' },
      { header: 'Stock', key: 'stock' },
      { header: 'Stock Max', key: 'stockMax' },
      { header: 'Faltan', key: 'faltan' },
    ];

    sheet.addRows(data);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename=inventario.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  }

  @Get('reporte/pdf')
  @UseGuards(JwtAuthGuard)
  async exportPDF(@Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }, @Res() res: Response) {
    const data = await this.service.reporteInventario(req.user);

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=inventario.pdf');

    doc.pipe(res);

    doc.fontSize(18).text('REPORTE DE INVENTARIO', { align: 'center' }).moveDown();
    doc.fontSize(10).text(`Fecha: ${new Date().toLocaleDateString()}`, { align: 'right' }).moveDown(2);
    doc.moveDown(1);

    const table = [
      ['Codigo', 'Producto', 'Talla', 'Color', 'Tela', 'Bodega', 'Stock', 'Stock Max', 'Faltan'],
      ...data.map((row) => [
        row.codigo,
        row.producto,
        row.talla || '',
        row.color || '',
        row.tela || '',
        row.bodega,
        row.stock.toString(),
        row.stockMax.toString(),
        row.faltan.toString(),
      ]),
    ];

    await (doc as any).table(table);

    doc.end();
  }
}
