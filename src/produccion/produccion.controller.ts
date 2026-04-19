import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { ProduccionService } from './produccion.service';

@Controller('produccion')
export class ProduccionController {
  constructor(private readonly service: ProduccionService) {}

  @Post()
  crearPedido(@Body() data: any) {
    return this.service.crearPedido(data);
  }

  @Get()
  listar() {
    return this.service.listarPedidos();
  }

  @Get(':id')
  detalle(@Param('id') id: number) {
    return this.service.detallePedido(Number(id));
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
