import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { LogsService } from './logs.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';

@Controller('logs')
export class LogsController {
  constructor(private service: LogsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async misLogs(@Req() req: { user: { usuario: string } }) {
    return this.service.listarPorUsuario(req.user.usuario);
  }

  @UseGuards(JwtAuthGuard)
  @Get('produccion/:id')
  async logsPedido(@Param('id') id: string) {
    return this.service.listarPorPedido(Number(id));
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('logs.view')
  @Get()
  async listar(@Query() query: { usuario?: string; desde?: string; hasta?: string; texto?: string }) {
    return this.service.listar(query);
  }
}
