import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InventarioTelasService } from './inventario-telas.service';

@Controller('inventario-telas')
@UseGuards(JwtAuthGuard)
export class InventarioTelasController {
  constructor(private readonly service: InventarioTelasService) {}

  @Get('rollos')
  listarRollos(@Query() query: any, @Req() req: { user?: any }) {
    return this.service.listarRollos(query, req.user);
  }

  @Get('resumen')
  resumen(@Query() query: any, @Req() req: { user?: any }) {
    return this.service.resumen(query, req.user);
  }

  @Post('rollos')
  crearRollo(@Body() body: any, @Req() req: { user?: any }) {
    return this.service.crearRollo(body, req.user);
  }

  @Patch('rollos/:id')
  actualizarRollo(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.actualizarRollo(id, body);
  }

  @Delete('rollos/:id')
  eliminarRollo(@Param('id', ParseIntPipe) id: number) {
    return this.service.eliminarRollo(id);
  }

  @Get('movimientos')
  listarMovimientos(@Query('rolloId') rolloId?: string) {
    return this.service.listarMovimientos(Number(rolloId || 0) || undefined);
  }

  @Post('movimientos')
  crearMovimiento(@Body() body: any, @Req() req: { user?: any }) {
    return this.service.crearMovimiento(body, req.user);
  }

  @Get('consumos')
  listarConsumos() {
    return this.service.listarConsumos();
  }

  @Post('consumos')
  crearConsumo(@Body() body: any) {
    return this.service.crearConsumo(body);
  }

  @Patch('consumos/:id')
  actualizarConsumo(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.actualizarConsumo(id, body);
  }

  @Delete('consumos/:id')
  eliminarConsumo(@Param('id', ParseIntPipe) id: number) {
    return this.service.eliminarConsumo(id);
  }
}
