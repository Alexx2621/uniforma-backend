import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RelacionesService } from './relaciones.service';

@Controller('relaciones')
@UseGuards(JwtAuthGuard)
export class RelacionesController {
  constructor(private readonly service: RelacionesService) {}

  @Get(':tipo/:id')
  find(@Param('tipo') tipo: string, @Param('id', ParseIntPipe) id: number) {
    return this.service.find(tipo, id);
  }
}
