import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ConsistenciaService } from './consistencia.service';
import { AnalizadorService } from './analizador.service';
import { IntencionService } from './intencion.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('consistencia')
export class ConsistenciaController {
  constructor(
    private readonly service: ConsistenciaService,
    private readonly analizador: AnalizadorService,
    private readonly intenciones: IntencionService,
  ) {}

  /** Localiza donde esta el descuadre de un documento, por folio. */
  @Get('analizar')
  @UseGuards(JwtAuthGuard)
  analizar(@Query('folio') folio: string) {
    return this.analizador.buscarPorFolio(folio);
  }

  /**
   * Punto de entrada del asistente: recibe lo que escribio el usuario, lo
   * interpreta y responde con lo que corresponda. El texto del usuario es lo
   * unico que puede salir hacia el modelo; los datos se resuelven aqui.
   */
  @Post('preguntar')
  @UseGuards(JwtAuthGuard)
  async preguntar(@Body() body: { texto?: string }) {
    const intencion = await this.intenciones.interpretar(body?.texto || '');

    if (intencion.intencion === 'analizar_documento' && intencion.folio) {
      try {
        return { tipo: 'analisis', intencion, analisis: await this.analizador.buscarPorFolio(intencion.folio) };
      } catch (error) {
        return { tipo: 'error', intencion, mensaje: (error as any)?.message || 'No encontre ese documento' };
      }
    }

    if (intencion.intencion === 'listar_descuadres') {
      return { tipo: 'hallazgos', intencion, hallazgos: await this.service.listar({ estado: 'abierto' }) };
    }

    return {
      tipo: 'sin_entender',
      intencion,
      mensaje:
        'Todavia no se resolver eso. Puedo revisar un documento si me pasas su folio (por ejemplo V-BO-0003), o decirte que descuadres hay pendientes.',
    };
  }

  @Get('hallazgos')
  @UseGuards(JwtAuthGuard)
  listar(@Query() query: { estado?: string; chequeo?: string }) {
    return this.service.listar(query);
  }

  /** Casos del mismo tipo ya resueltos, con la nota de como se cuadraron. */
  @Get('hallazgos/:id/parecidos')
  @UseGuards(JwtAuthGuard)
  parecidos(@Param('id') id: string) {
    return this.service.casosParecidos(Number(id));
  }

  @Patch('hallazgos/:id/resolver')
  @UseGuards(JwtAuthGuard)
  resolver(@Param('id') id: string, @Body() body: any, @Req() req: { user?: { id?: number } }) {
    return this.service.resolver(Number(id), body, req.user);
  }

  /** Dispara el barrido. Pensado para un cron, igual que el de alertas. */
  @Post('revisar')
  @UseGuards(JwtAuthGuard)
  revisar() {
    return this.service.registrarHallazgos();
  }
}
