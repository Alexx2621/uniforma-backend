import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly service: RolesService) {}

  @Get()
  getRoles() {
    return this.service.findAll();
  }

  @Post()
  crearRol(@Body() data: any) {
    return this.service.create(data);
  }

  @Get(':id')
  getRol(@Param('id') id: number) {
    return this.service.findOne(Number(id));
  }
}
