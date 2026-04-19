import { Controller, Post, Get, Body } from '@nestjs/common';
import { TrasladosService } from './traslados.service';

@Controller('traslados')
export class TrasladosController {
  constructor(private readonly service: TrasladosService) {}

  @Post()
  crear(@Body() body: any) {
    return this.service.crearTraslado(body);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }
}
