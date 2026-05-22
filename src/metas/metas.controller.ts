import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MetasService } from './metas.service';

@Controller('metas')
@UseGuards(JwtAuthGuard)
export class MetasController {
  constructor(private readonly service: MetasService) {}

  @Get('mensuales')
  listar(
    @Req() req: { user?: any },
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('bodegaId') bodegaId?: string,
    @Query('usuarioId') usuarioId?: string,
  ) {
    return this.service.listar(req.user, { year, month, bodegaId, usuarioId });
  }

  @Get('mensuales/actual')
  actual(
    @Req() req: { user?: any },
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('bodegaId') bodegaId?: string,
    @Query('usuarioId') usuarioId?: string,
    @Query('scope') scope?: string,
  ) {
    return this.service.resolverActual(req.user, { year, month, bodegaId, usuarioId, scope });
  }

  @Post('mensuales')
  guardar(@Req() req: { user?: any }, @Body() body: any) {
    return this.service.guardar(req.user, body);
  }

  @Delete('mensuales/:id')
  eliminar(@Req() req: { user?: any }, @Param('id', ParseIntPipe) id: number) {
    return this.service.eliminar(req.user, id);
  }
}
