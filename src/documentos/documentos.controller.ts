import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocumentosService } from './documentos.service';

@Controller('documentos')
@UseGuards(JwtAuthGuard)
export class DocumentosController {
  constructor(private readonly service: DocumentosService) {}

  @Get()
  listar(@Query('tipo') tipo?: string, @Query('usuarioId') usuarioId?: string) {
    const usuarioIdNumber = usuarioId ? Number(usuarioId) : undefined;
    return this.service.listar(tipo, usuarioIdNumber);
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.service.obtener(id);
  }

  @Get(':id/pdf')
  async descargarPdf(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { filename, pdf } = await this.service.generarPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  }

  @Post()
  crear(
    @Req() req: { user?: { id?: number } },
    @Body() body: { tipo?: string; titulo?: string; data?: unknown },
  ) {
    return this.service.crear(Number(req.user?.id), body);
  }

  @Patch(':id')
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() body: { titulo?: string; data?: unknown }) {
    return this.service.actualizar(id, body);
  }

  @Delete(':id')
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.service.eliminar(id);
  }
}
