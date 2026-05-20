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
    @Res({ passthrough: true }) res: Response,
    @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } },
    @Query('tipo') tipo?: string,
    @Query('usuarioId') usuarioId?: string,
  ) {
    this.setNoCacheHeaders(res);
    const usuarioIdNumber = usuarioId ? Number(usuarioId) : undefined;
    return this.service.listar(req.user, tipo, usuarioIdNumber);
  }

  @Get(':id')
  obtener(
    @Res({ passthrough: true }) res: Response,
    @Req() req: { user?: { id?: number; rol?: string } },
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.setNoCacheHeaders(res);
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
    @Req() req: { user?: { id?: number; rol?: string } },
    @Body() body: { tipo?: string; titulo?: string; data?: unknown; usuarioId?: number; omitirCorreo?: boolean },
  ) {
    return this.service.crear(req.user, body);
  }

  @Patch(':id')
  actualizar(
    @Req() req: { user?: { id?: number; rol?: string } },
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { titulo?: string; data?: unknown; omitirCorreo?: boolean },
  ) {
    return this.service.actualizar(id, body, req.user);
  }

  @Delete(':id')
  eliminar(@Req() req: { user?: { id?: number; rol?: string } }, @Param('id', ParseIntPipe) id: number) {
    return this.service.eliminar(id, req.user);
  }

  private setNoCacheHeaders(res: Response) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}
