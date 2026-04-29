import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PostventaService } from './postventa.service';

@Controller('postventa')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PostventaController {
  constructor(private readonly service: PostventaService) {}

  @Get()
  @Permissions('postventa.view')
  listar(
    @Query('tipo') tipo?: string,
    @Query('estado') estado?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('usuarioId') usuarioId?: string,
    @Req() req?: { user?: { id?: number; rol?: string } },
  ) {
    return this.service.listar({ tipo, estado, desde, hasta, usuarioId }, req?.user);
  }

  @Get(':id')
  @Permissions('postventa.view')
  obtener(@Param('id', ParseIntPipe) id: number, @Req() req: { user?: { id?: number; rol?: string } }) {
    return this.service.obtener(id, req.user);
  }

  @Post()
  @Permissions('postventa.manage')
  crear(@Body() body: any, @Req() req: { user?: { id?: number } }) {
    return this.service.crear(body, req.user?.id);
  }

  @Patch(':id')
  @Permissions('postventa.manage')
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Req() req: { user?: { id?: number; rol?: string } },
  ) {
    return this.service.actualizar(id, body, req.user);
  }

  @Post(':id/anular')
  @Permissions('postventa.manage')
  anular(@Param('id', ParseIntPipe) id: number, @Req() req: { user?: { id?: number; rol?: string } }) {
    return this.service.cambiarEstado(id, 'anulado', req.user);
  }

  @Post(':id/cerrar')
  @Permissions('postventa.manage')
  cerrar(@Param('id', ParseIntPipe) id: number, @Req() req: { user?: { id?: number; rol?: string } }) {
    return this.service.cambiarEstado(id, 'cerrado', req.user);
  }
}
