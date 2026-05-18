import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CorreccionesService } from './correcciones.service';

@Controller('correcciones')
@UseGuards(JwtAuthGuard)
export class CorreccionesController {
  constructor(private readonly service: CorreccionesService) {}

  @Get('documentos')
  buscarDocumentos(
    @Query('tipo') tipo?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.buscarDocumentos({ tipo, q, limit: Number(limit || 25) });
  }

  @Get('documentos/:id')
  obtenerDocumento(@Param('id', ParseIntPipe) id: number) {
    return this.service.obtenerDocumento(id);
  }

  @Patch('documentos/:id')
  corregirDocumento(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { campo?: string; valorNuevo?: unknown; motivo?: string },
    @Req() req: { user?: { id?: number; rol?: string } },
  ) {
    return this.service.corregirDocumento(id, body, req.user);
  }

  @Get('historial')
  historial(@Query('documentoId') documentoId?: string) {
    return this.service.historial(Number(documentoId || 0) || undefined);
  }
}
