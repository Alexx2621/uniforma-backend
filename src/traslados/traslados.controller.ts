import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { TrasladosService } from './traslados.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('traslados')
export class TrasladosController {
  constructor(private readonly service: TrasladosService) {}

  @Post()
  crear(@Body() body: any) {
    return this.service.crearTraslado(body);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Req() req: { user?: { id?: number; rol?: string; permisos?: string[] } }) {
    return this.service.findAll(req.user);
  }
}
