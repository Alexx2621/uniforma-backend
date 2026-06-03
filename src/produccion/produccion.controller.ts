import { Controller, Post, Body, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ProduccionService } from './produccion.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('produccion')
export class ProduccionController {
  constructor(private readonly service: ProduccionService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  crearPedido(@Body() data: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.crearPedido(data, req.user?.id, req.user);
  }

  @Post('autorizaciones')
  @UseGuards(JwtAuthGuard)
  solicitarAutorizacionPedido(
    @Body() data: { pedido?: any; comentario?: string },
    @Req() req: { user?: { id?: number; usuario?: string; rol?: string; permisos?: string[] } },
  ) {
    return this.service.solicitarAutorizacionPedido(data?.pedido || data, req.user?.id, req.user, data?.comentario);
  }

  @Post('autorizaciones/:id/aprobar')
  @UseGuards(JwtAuthGuard)
  aprobarAutorizacionPedido(
    @Param('id') id: string,
    @Body() data: { comentario?: string },
    @Req() req: { user?: { id?: number; usuario?: string; rol?: string; permisos?: string[] } },
  ) {
    return this.service.aprobarAutorizacionPedido(Number(id), req.user, data?.comentario);
  }

  @Post('autorizaciones/:id/rechazar')
  @UseGuards(JwtAuthGuard)
  rechazarAutorizacionPedido(
    @Param('id') id: string,
    @Body() data: { comentario?: string },
    @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } },
  ) {
    return this.service.rechazarAutorizacionPedido(Number(id), req.user, data?.comentario);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  listar(@Req() req: { user?: { id?: number; rol?: string; rolId?: number | null; permisos?: string[] | null } }, @Query() query: any) {
    return this.service.listarPedidos(req.user, query);
  }

  @Get('bordados')
  @UseGuards(JwtAuthGuard)
  listarBordados(
    @Req() req: { user?: { id?: number; rol?: string; rolId?: number | null; permisos?: string[] | null } },
    @Query('usuarioId') usuarioId?: string,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
  ) {
    return this.service.listarBordados(req.user, Number(usuarioId || 0) || null, { fechaInicio, fechaFin });
  }

  @Post('bordados/detalle/:detalleId')
  @UseGuards(JwtAuthGuard)
  actualizarDetalleBordado(
    @Param('detalleId') detalleId: number,
    @Body() data: any,
    @Req() req: { user?: { id?: number; rol?: string; rolId?: number | null; permisos?: string[] | null } },
  ) {
    return this.service.actualizarDetalleBordado(Number(detalleId), data, req.user);
  }

  @Post('bordados/venta/detalle/:detalleId')
  @UseGuards(JwtAuthGuard)
  actualizarDetalleVentaBordado(
    @Param('detalleId') detalleId: number,
    @Body() data: any,
    @Req() req: { user?: { id?: number; rol?: string; rolId?: number | null; permisos?: string[] | null } },
  ) {
    return this.service.actualizarDetalleVentaBordado(Number(detalleId), data, req.user);
  }

  @Get(':id')
  detalle(@Param('id') id: number) {
    return this.service.detallePedido(Number(id));
  }

  @Post(':id/anular')
  anularPedido(@Param('id') id: number) {
    return this.service.anularPedido(Number(id));
  }

  @Post(':id/regresar')
  regresarPedido(@Param('id') id: number, @Body() data: any) {
    return this.service.regresarPedido(Number(id), data);
  }

  @Post(':id/terminar')
  terminarPedido(@Param('id') id: number, @Body() data: any) {
    return this.service.terminarPedido(Number(id), data);
  }

  @Post(':id/pago')
  registrarPago(@Param('id') id: number, @Body() data: any) {
    return this.service.registrarPago(Number(id), data);
  }
}
