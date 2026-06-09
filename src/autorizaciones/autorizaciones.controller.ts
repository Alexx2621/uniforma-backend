import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AutorizacionesService } from './autorizaciones.service';

@Controller('autorizaciones')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AutorizacionesController {
  constructor(private readonly service: AutorizacionesService) {}

  @Get()
  @Permissions('autorizaciones.view')
  listar(
    @Query('estado') estado?: string,
    @Query('tipo') tipo?: string,
    @Req() req?: { user?: { id?: number; rol?: string; permisos?: string[] } },
  ) {
    return this.service.listar({ estado, tipo }, req?.user);
  }
}
