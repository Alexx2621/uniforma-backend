import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IngresosService } from './ingresos.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('ingresos')
@UseGuards(JwtAuthGuard)
export class IngresosController {
  constructor(private readonly service: IngresosService) {}

  @Post()
  crear(@Body() body: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.crearIngreso(body, req.user);
  }

  @Post('importar')
  importar(@Body() body: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.importar(body, req.user);
  }

  @Get()
  findAll(@Query() query: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.findAll(query, req.user);
  }
}
