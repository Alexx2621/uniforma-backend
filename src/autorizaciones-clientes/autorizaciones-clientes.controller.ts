import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AutorizacionesClientesService } from './autorizaciones-clientes.service';
@Controller('autorizaciones-clientes') @UseGuards(JwtAuthGuard)
export class AutorizacionesClientesController {
  constructor(private service: AutorizacionesClientesService) {}
  @Get('pendientes') pendientes(@Req() req: any) { return this.service.listarPendientes(req.user); }
  @Post() solicitar(@Req() req: any, @Body() body: any) { return this.service.solicitar(req.user, body); }
  @Post(':id/aprobar') aprobar(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() body: any) { return this.service.resolver(id, req.user, true, body); }
  @Post(':id/rechazar') rechazar(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() body: any) { return this.service.resolver(id, req.user, false, body); }
}
