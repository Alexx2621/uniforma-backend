import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TrackingService } from './tracking.service';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Get('pedidos')
  @UseGuards(JwtAuthGuard)
  listarPedidos(
    @Req() req: { user?: { id?: number; rol?: string | null; rolId?: number | null } },
    @Query() query: { usuarioId?: string; fechaInicio?: string; fechaFin?: string },
  ) {
    return this.trackingService.listarPedidosTracking(req.user, query);
  }

  @Post('pedidos/:pedidoId/enviar')
  @UseGuards(JwtAuthGuard)
  reenviarTracking(
    @Param('pedidoId') pedidoId: string,
    @Req() req: { user?: { rol?: string | null; permisos?: string[] | null } },
  ) {
    return this.trackingService.reenviarTracking(Number(pedidoId), req.user);
  }

  @Patch('pedidos/:pedidoId/estado')
  @UseGuards(JwtAuthGuard)
  actualizarEstado(
    @Param('pedidoId') pedidoId: string,
    @Body() body: { estado?: string; mensaje?: string | null },
    @Req() req: { user?: { rol?: string | null; permisos?: string[] | null } },
  ) {
    return this.trackingService.actualizarEstadoTracking(Number(pedidoId), body, req.user);
  }
}
