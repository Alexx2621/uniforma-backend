import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RolesService } from './roles.service';

@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly service: RolesService) {}

  @Get()
  @Permissions('roles.view')
  getRoles() {
    return this.service.findAll();
  }

  @Get('permisos/catalogo')
  @Permissions('roles.view')
  getPermissionCatalog() {
    return this.service.getPermissionCatalog();
  }

  @Post()
  @Permissions('roles.manage')
  crearRol(@Body() data: any) {
    return this.service.create(data);
  }

  @Get(':id')
  @Permissions('roles.view')
  getRol(@Param('id') id: number) {
    return this.service.findOne(Number(id));
  }

  @Put(':id')
  @Permissions('roles.manage')
  actualizarRol(@Param('id') id: number, @Body() data: any) {
    return this.service.update(Number(id), data);
  }

  @Delete(':id')
  @Permissions('roles.manage')
  eliminarRol(@Param('id') id: number) {
    return this.service.remove(Number(id));
  }
}
