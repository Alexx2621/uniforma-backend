import { Controller, Post, Get, Body, Query, Req, UseGuards } from '@nestjs/common';
import { VentasService } from './ventas.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('ventas')
export class VentasController {
  constructor(private readonly service: VentasService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() body: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.createVenta(body, Number(req.user?.id || body?.usuarioId || 0) || null, req.user);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }, @Query() query: any) {
    return this.service.findAll(req.user, query);
  }
  
}
