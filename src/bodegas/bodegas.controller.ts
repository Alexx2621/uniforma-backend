import { Controller, Get, Post, Body, Put, Param, Delete } from '@nestjs/common';
import { BodegasService } from './bodegas.service';

@Controller('bodegas')
export class BodegasController {
  constructor(private readonly service: BodegasService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() body: { nombre: string; ubicacion?: string | null }) {
    return this.service.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: { nombre: string; ubicacion?: string | null }) {
    return this.service.update(Number(id), body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(Number(id));
  }
}
