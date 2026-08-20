import { Controller, Post, Get, Body, Query, Req, UseGuards } from '@nestjs/common';
import { VentasService } from './ventas.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('ventas')
export class VentasController {
  constructor(private readonly service: VentasService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() body: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[]; bodegaId?: number | string | null } }) {
    // La marca de venta especial no se acepta por aqui: solo la pone el
    // servicio de ventas especiales tras validar que el cliente sea trabajador
    // y que un ADMIN lo autorizara. Si llegara del cuerpo, cualquiera podria
    // registrar una venta real y esconderla de los reportes de ingresos.
    const { esVentaEspecial: _ignorado, ...datos } = body || {};
    return this.service.createVenta(datos, Number(req.user?.id || body?.usuarioId || 0) || null, req.user);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }, @Query() query: any) {
    return this.service.findAll(req.user, query);
  }
  
}
