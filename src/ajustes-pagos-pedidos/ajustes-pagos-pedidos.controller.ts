import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AjustesPagosPedidosService } from './ajustes-pagos-pedidos.service';

@Controller('ajustes-pagos-pedidos')
@UseGuards(JwtAuthGuard)
export class AjustesPagosPedidosController {
  constructor(private readonly service: AjustesPagosPedidosService) {}

  @Get()
  listar(@Req() req: any, @Query('estado') estado?: string, @Query('q') q?: string) {
    return this.service.listar(req.user, { estado, q });
  }

  @Post()
  crear(@Req() req: any, @Body() body: any) {
    return this.service.crear(req.user, body);
  }

  @Post(':id/aprobar')
  aprobar(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() body: any) {
    return this.service.aprobar(id, req.user, body);
  }

  @Post(':id/rechazar')
  rechazar(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() body: any) {
    return this.service.rechazar(id, req.user, body);
  }
}
