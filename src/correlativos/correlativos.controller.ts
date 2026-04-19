import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
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
  generarProduccionCorrelativo(@Body() body: { bodegaId?: number | null }) {
    return this.service.generarProduccionCorrelativo(body?.bodegaId ?? null);
  }
}
