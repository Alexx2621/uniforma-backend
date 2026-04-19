import { Controller, Post, Get, Body } from '@nestjs/common';
import { VentasService } from './ventas.service';

@Controller('ventas')
export class VentasController {
  constructor(private readonly service: VentasService) {}

  @Post()
  create(@Body() body: any) {
    return this.service.createVenta(body);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }
  
}
