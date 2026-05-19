import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EnviosService } from './envios.service';

@Controller('envios')
@UseGuards(JwtAuthGuard)
export class EnviosController {
  constructor(private readonly service: EnviosService) {}

  @Get()
  findAll(
    @Req() req: { user?: any },
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('usuarioId') usuarioId?: string,
    @Query('estado') estado?: string,
  ) {
    return this.service.findAll(req.user, { desde, hasta, usuarioId, estado });
  }

  @Get('documentos')
  documentosRelacionables(@Req() req: { user?: any }, @Query('q') q?: string) {
    return this.service.documentosRelacionables(req.user, q);
  }

  @Get(':id')
  findOne(@Req() req: { user?: any }, @Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id, req.user);
  }

  @Post()
  create(@Req() req: { user?: any }, @Body() body: any) {
    return this.service.create(req.user, body);
  }

  @Patch(':id/estado')
  updateEstado(@Req() req: { user?: any }, @Param('id', ParseIntPipe) id: number, @Body() body: { estado?: string }) {
    return this.service.updateEstado(id, body.estado, req.user);
  }
}
