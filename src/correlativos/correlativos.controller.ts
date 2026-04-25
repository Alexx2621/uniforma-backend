import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CorrelativosService } from './correlativos.service';

@Controller('correlativos')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CorrelativosController {
  constructor(private readonly service: CorrelativosService) {}

  @Get('produccion')
  @Permissions('correlativos.view')
  listarProduccion() {
    return this.service.listarProduccion();
  }

  @Get('usuario-operaciones')
  @Permissions('correlativos.view')
  listarUsuarioOperaciones() {
    return this.service.listarUsuarioOperaciones();
  }

  @Get('usuario-operaciones/actual/:operacion')
  obtenerSiguienteUsuarioOperacion(@Req() req: { user?: { id?: number } }, @Param('operacion') operacion: string) {
    return this.service.obtenerSiguienteUsuarioOperacionCorrelativo(Number(req.user?.id), operacion);
  }

  @Put('usuario-operaciones/:usuarioId/:operacion')
  @Permissions('correlativos.manage')
  actualizarUsuarioOperacion(
    @Param('usuarioId', ParseIntPipe) usuarioId: number,
    @Param('operacion') operacion: string,
    @Body() body: { abreviatura?: string; siguienteNumero?: number; codigoUsuario?: string },
  ) {
    return this.service.actualizarUsuarioOperacion(usuarioId, operacion, body);
  }

  @Post('usuario-operaciones/generar')
  generarUsuarioOperacion(@Req() req: { user?: { id?: number } }, @Body() body: { operacion?: string }) {
    return this.service.generarUsuarioOperacionCorrelativo(Number(req.user?.id), `${body?.operacion || ''}`);
  }

  @Put('produccion/global')
  @Permissions('correlativos.manage')
  actualizarGlobal(@Body() body: { abreviatura?: string; siguienteNumero?: number }) {
    return this.service.actualizarGlobal(body);
  }

  @Put('produccion/bodega/:bodegaId')
  @Permissions('correlativos.manage')
  actualizarBodega(
    @Param('bodegaId', ParseIntPipe) bodegaId: number,
    @Body() body: { abreviatura?: string; siguienteNumero?: number },
  ) {
    return this.service.actualizarBodega(bodegaId, body);
  }

  @Post('produccion/generar')
  @Permissions('produccion.view')
  generarProduccionCorrelativo(
    @Body()
    body: {
      bodegaId?: number | null;
      pedidoIds?: number[];
      firmaContenido?: string | null;
      resumen?: unknown;
    },
  ) {
    return this.service.generarProduccionCorrelativo(body);
  }
}
