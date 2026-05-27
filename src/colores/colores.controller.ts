import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ColoresService } from './colores.service';

@Controller('colores')
export class ColoresController {
  constructor(private readonly service: ColoresService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('proveedor-aliases')
  listarAliases(@Query() query: any) {
    return this.service.listarAliases(query);
  }

  @Post('proveedor-aliases')
  crearAlias(@Body() body: any) {
    return this.service.crearAlias(body);
  }

  @Patch('proveedor-aliases/:id')
  actualizarAlias(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.actualizarAlias(id, body);
  }

  @Delete('proveedor-aliases/:id')
  eliminarAlias(@Param('id', ParseIntPipe) id: number) {
    return this.service.eliminarAlias(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.service.delete(id);
  }
}
