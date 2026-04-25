import { Controller, Post, Body, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ProduccionService } from './produccion.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('produccion')
export class ProduccionController {
  constructor(private readonly service: ProduccionService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  crearPedido(@Body() data: any, @Req() req: { user?: { id?: number } }) {
    return this.service.crearPedido(data, req.user?.id);
  }

  @Get()
  listar() {
    return this.service.listarPedidos();
  }

  @Get(':id')
  detalle(@Param('id') id: number) {
    return this.service.detallePedido(Number(id));
  }

  @Post(':id/anular')
  anularPedido(@Param('id') id: number) {
    return this.service.anularPedido(Number(id));
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
