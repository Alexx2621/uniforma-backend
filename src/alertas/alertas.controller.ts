import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AlertasService } from './alertas.service';

@Controller('alertas')
@UseGuards(JwtAuthGuard)
export class AlertasController {
  constructor(private readonly service: AlertasService) {}

  @Get()
  listar(@Req() req: { user: { id: number } }) {
    return this.service.listarPorUsuario(req.user.id);
  }

  @Post(':id/leida')
  marcarLeida(@Req() req: { user: { id: number } }, @Param('id') id: string) {
    return this.service.marcarLeida(req.user.id, Number(id));
  }

  @Post('marcar-todas-leidas')
  marcarTodasLeidas(@Req() req: { user: { id: number } }) {
    return this.service.marcarTodasLeidas(req.user.id);
  }

  @Post('mensaje-actualizacion')
  crearMensajeActualizacion(
    @Req() req: { user: { usuario?: string } },
    @Body() body: { mensaje?: string },
  ) {
    return this.service.crearMensajeActualizacion({
      mensaje: body?.mensaje || '',
      enviadoPor: req.user?.usuario,
    });
  }
}
