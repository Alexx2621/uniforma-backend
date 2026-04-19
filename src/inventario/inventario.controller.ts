import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InventarioService } from './inventario.service';

import PDFDocument from 'pdfkit';
import PDFTable from 'pdfkit-table';

@Controller('inventario')
export class InventarioController {
  constructor(private readonly service: InventarioService) {}

  @Get('reporte')
  getReporte() {
    return this.service.reporteInventario();
  }

  @Get('resumen')
  getResumen() {
    return this.service.resumenPorProducto();
  }

  @Get(':bodegaId/:productoId')
  async getStock(@Param('bodegaId') bodegaId: string, @Param('productoId') productoId: string) {
    const stock = await this.service.obtenerStockActual(Number(bodegaId), Number(productoId));
    return { stock };
  }

  @Get('reporte/excel')
  async exportExcel(@Res() res: Response) {
    const data = await this.service.reporteInventario();

    const Excel = require('exceljs');
    const workbook = new Excel.Workbook();
    const sheet = workbook.addWorksheet('Inventario');

    sheet.columns = [
      { header: 'Código', key: 'codigo' },
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
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=inventario.xlsx',
    );

    await workbook.xlsx.write(res);
    res.end();
  }

  @Get('reporte/pdf')
  async exportPDF(@Res() res: Response) {
    const data = await this.service.reporteInventario();

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=inventario.pdf');

    doc.pipe(res);

    // Título
    doc.fontSize(18).text('REPORTE DE INVENTARIO', { align: 'center' }).moveDown();

    doc.fontSize(10).text(`Fecha: ${new Date().toLocaleDateString()}`, { align: 'right' }).moveDown(2);

    // Márgenes
    doc.moveDown(1);

    // Tablas
    const table = [
      ['Código', 'Producto', 'Talla', 'Color', 'Tela', 'Bodega', 'Stock', 'Stock Max', 'Faltan'],
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

    await doc.table();

    doc.end();
  }
}
