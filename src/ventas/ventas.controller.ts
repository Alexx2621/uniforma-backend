import { Controller, Post, Get, Body, Req } from '@nestjs/common';
import { VentasService } from './ventas.service';

@Controller('ventas')
export class VentasController {
  constructor(private readonly service: VentasService) {}

  @Post()
  create(@Body() body: any, @Req() req: { user?: { id?: number } }) {
    return this.service.createVenta(body, Number(req.user?.id || body?.usuarioId || 0) || null);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }
  
}
