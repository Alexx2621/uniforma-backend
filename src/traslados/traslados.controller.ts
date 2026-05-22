import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { TrasladosService } from './traslados.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('traslados')
export class TrasladosController {
  constructor(private readonly service: TrasladosService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  crear(@Body() body: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.crearTraslado(body, req.user);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Query() query: any, @Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.findAll(query, req.user);
  }
}
