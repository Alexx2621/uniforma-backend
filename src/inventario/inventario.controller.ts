import { Body, Controller, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
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

  @Get('kardex')
  @UseGuards(JwtAuthGuard)
  getKardex(@Query() query: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.kardex(query, req.user);
  }

  @Get('alertas-bodega')
  @UseGuards(JwtAuthGuard)
  getAlertas(@Query() query: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.alertasBodega(query, req.user);
  }

  @Get('conteos')
  @UseGuards(JwtAuthGuard)
  getConteos(@Query() query: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.listarConteos(query, req.user);
  }

  @Post('conteos')
  @UseGuards(JwtAuthGuard)
  crearConteo(@Body() body: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.crearConteo(body, req.user);
  }

  @Put('minimos')
  @UseGuards(JwtAuthGuard)
  guardarMinimo(@Body() body: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.guardarMinimo(body, req.user);
  }

  @Get(':bodegaId/:productoId')
  @UseGuards(JwtAuthGuard)
  async getStock(
    @Param('bodegaId') bodegaId: string,
    @Param('productoId') productoId: string,
    @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } },
  ) {
    const stock = await this.service.obtenerStockActual(Number(bodegaId), Number(productoId), req.user);
    return { stock };
  }
}
