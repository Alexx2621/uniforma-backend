import { Controller, Get, Post, Body, Put, Param, Delete, Query, Req, UseGuards } from '@nestjs/common';
import { BodegasService } from './bodegas.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('bodegas')
@UseGuards(JwtAuthGuard)
export class BodegasController {
  constructor(private readonly service: BodegasService) {}

  @Get()
  findAll(@Query('operacion') operacion?: any, @Query('activas') activas?: string, @Req() req?: any) {
    return this.service.findAll({ operacion, activas }, req?.user);
  }

  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(Number(id), body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(Number(id));
  }
}
