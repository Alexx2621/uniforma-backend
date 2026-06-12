import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocumentosBorradoresService } from './documentos-borradores.service';

@Controller('documentos-borradores')
@UseGuards(JwtAuthGuard)
export class DocumentosBorradoresController {
  constructor(private readonly service: DocumentosBorradoresService) {}

  @Get()
  findAll(@Req() req: any, @Query('tipoDocumento') tipoDocumento?: string) {
    return this.service.findAll(req.user, tipoDocumento);
  }

  @Get('contador')
  countOpen(@Req() req: any) {
    return this.service.countOpen(req.user);
  }

  @Get('activo')
  findActive(@Req() req: any, @Query('tipoDocumento') tipoDocumento: string) {
    return this.service.findActive(req.user, tipoDocumento);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.service.findOne(req.user, Number(id));
  }

  @Post('autoguardar')
  autosave(@Req() req: any, @Body() data: any) {
    return this.service.autosave(req.user, data);
  }

  @Post('limpieza-admin')
  adminCleanup(@Req() req: any) {
    return this.service.adminCleanup(req.user);
  }

  @Post(':id/finalizar')
  finalize(@Req() req: any, @Param('id') id: string, @Body() data: any) {
    return this.service.changeStatus(req.user, Number(id), 'finalizado', data);
  }

  @Post(':id/bloquear')
  lock(@Req() req: any, @Param('id') id: string) {
    return this.service.lock(req.user, Number(id));
  }

  @Post(':id/liberar')
  unlock(@Req() req: any, @Param('id') id: string) {
    return this.service.unlock(req.user, Number(id));
  }

  @Delete(':id')
  discard(@Req() req: any, @Param('id') id: string) {
    return this.service.discard(req.user, Number(id));
  }
}
