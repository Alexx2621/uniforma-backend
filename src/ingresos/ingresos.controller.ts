import { Controller, Post, Body, Get } from '@nestjs/common';
import { IngresosService } from './ingresos.service';

@Controller('ingresos')
export class IngresosController {
  constructor(private readonly service: IngresosService) {}

  @Post()
  crear(@Body() body: any) {
    return this.service.crearIngreso(body);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }
}
