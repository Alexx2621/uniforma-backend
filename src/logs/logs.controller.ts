import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { LogsService } from './logs.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('logs')
export class LogsController {
  constructor(private service: LogsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async misLogs(@Req() req: { user: { usuario: string } }) {
    return this.service.listarPorUsuario(req.user.usuario);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get()
  async listar() {
    return this.service.listar();
  }
}
