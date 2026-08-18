import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { TrasladosService } from './traslados.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('traslados')
export class TrasladosController {
  constructor(private readonly service: TrasladosService) {}

  // "Nuevo traslado" ya no mueve stock al instante: crea una solicitud que
  // debe autorizar la tienda origen, igual que "solicitudes" (ver mas abajo).
  @Post()
  @UseGuards(JwtAuthGuard)
  crear(
    @Body() body: any,
    @Req() req: { user?: { id?: number; rol?: string; permisos?: string[]; usuario?: string; nombre?: string } },
  ) {
    return this.service.crearSolicitud(body, req.user);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Query() query: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.findAll(query, req.user);
  }

  @Get('solicitudes')
  @UseGuards(JwtAuthGuard)
  findSolicitudes(@Query() query: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.findSolicitudes(query, req.user);
  }

  @Post('solicitudes')
  @UseGuards(JwtAuthGuard)
  crearSolicitud(
    @Body() body: any,
    @Req() req: { user?: { id?: number; rol?: string; permisos?: string[]; usuario?: string; nombre?: string } },
  ) {
    return this.service.crearSolicitud(body, req.user);
  }

  @Patch('solicitudes/:id/estado')
  @UseGuards(JwtAuthGuard)
  actualizarSolicitudEstado(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } },
  ) {
    return this.service.actualizarSolicitudEstado(Number(id), body, req.user);
  }

  @Patch('solicitudes/:id/recibir-parcial')
  @UseGuards(JwtAuthGuard)
  recibirSolicitudParcial(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } },
  ) {
    return this.service.recibirSolicitudParcial(Number(id), body, req.user);
  }
}
