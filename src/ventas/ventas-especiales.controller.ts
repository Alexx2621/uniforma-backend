import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { VentasEspecialesService } from './ventas-especiales.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

type Peticion = { user?: { id?: number; rol?: string | null; permisos?: string[] | null; usuario?: string | null } };

@Controller('ventas-especiales')
@UseGuards(JwtAuthGuard)
export class VentasEspecialesController {
  constructor(private readonly service: VentasEspecialesService) {}

  /** El vendedor pide entregar producto sin cobro a un trabajador. */
  @Post()
  solicitar(@Body() body: any, @Req() req: Peticion) {
    return this.service.solicitar(body, req.user, body?.comentario);
  }

  @Post(':id/aprobar')
  aprobar(@Param('id') id: string, @Body() body: any, @Req() req: Peticion) {
    return this.service.aprobar(Number(id), req.user, body?.comentario);
  }

  @Post(':id/rechazar')
  rechazar(@Param('id') id: string, @Body() body: any, @Req() req: Peticion) {
    return this.service.rechazar(Number(id), req.user, body?.comentario);
  }
}
