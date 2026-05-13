import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private service: WhatsappService) {}

  @Get('webhook')
  verificarWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    return this.service.verificarWebhook(mode, token, challenge);
  }

  @Post('webhook')
  @HttpCode(200)
  recibirWebhook(@Body() body: any) {
    return this.service.procesarWebhook(body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('resumen')
  resumen(@Req() req: { user: { id?: number; rol?: string } }) {
    return this.service.resumen(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('config')
  listarConfiguracion(@Req() req: { user: { id?: number; rol?: string } }) {
    return this.service.listarConfiguracion(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('config/:usuarioId')
  actualizarConfiguracion(
    @Req() req: { user: { id?: number; rol?: string } },
    @Param('usuarioId') usuarioId: string,
    @Body() body: any,
  ) {
    return this.service.actualizarConfiguracion(req.user, Number(usuarioId), body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mensajes')
  registrarMensaje(@Req() req: { user: { id?: number; rol?: string } }, @Body() body: any) {
    return this.service.registrarMensaje(req.user, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('mensajes/leidos')
  marcarLeidos(@Req() req: { user: { id?: number; rol?: string } }, @Body() body: { vendedorId?: number }) {
    return this.service.marcarLeidos(req.user, body?.vendedorId);
  }
}
