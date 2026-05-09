import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocumentosService } from './documentos.service';

@Controller('documentos')
@UseGuards(JwtAuthGuard)
export class DocumentosController {
  constructor(private readonly service: DocumentosService) {}

  @Get()
  listar(
    @Req() req: { user?: { id?: number; rol?: string } },
    @Query('tipo') tipo?: string,
    @Query('usuarioId') usuarioId?: string,
  ) {
    const usuarioIdNumber = usuarioId ? Number(usuarioId) : undefined;
    return this.service.listar(req.user, tipo, usuarioIdNumber);
  }

  @Get(':id')
  obtener(@Req() req: { user?: { id?: number; rol?: string } }, @Param('id', ParseIntPipe) id: number) {
    return this.service.obtener(id, req.user);
  }

  @Get(':id/pdf')
  async descargarPdf(
    @Req() req: { user?: { id?: number; rol?: string } },
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const { filename, pdf } = await this.service.generarPdf(id, req.user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
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
  actualizar(
    @Req() req: { user?: { id?: number; rol?: string } },
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { titulo?: string; data?: unknown },
  ) {
    return this.service.actualizar(id, body, req.user);
  }

  @Delete(':id')
  eliminar(@Req() req: { user?: { id?: number; rol?: string } }, @Param('id', ParseIntPipe) id: number) {
    return this.service.eliminar(id, req.user);
  }
}
