import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocumentosService } from './documentos.service';

@Controller('documentos')
@UseGuards(JwtAuthGuard)
export class DocumentosController {
  constructor(private readonly service: DocumentosService) {}

  @Get()
  listar(@Query('tipo') tipo?: string) {
    return this.service.listar(tipo);
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.service.obtener(id);
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
