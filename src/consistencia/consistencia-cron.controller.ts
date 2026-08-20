import { Controller, Headers, Post, Query } from '@nestjs/common';
import { AutomatizacionesService } from '../automatizaciones/automatizaciones.service';
import { validarTokenCron } from '../common/cron-auth';
import { ConsistenciaService } from './consistencia.service';

/** Entrada sin sesion para el Cron Job de cPanel, protegida por token. */
@Controller('consistencia-cron')
export class ConsistenciaCronController {
  constructor(
    private readonly service: ConsistenciaService,
    private readonly automatizaciones: AutomatizacionesService,
  ) {}

  @Post('revisar')
  revisar(
    @Headers('x-cron-token') tokenCabecera?: string,
    @Query('token') tokenQuery?: string,
  ) {
    // El token anterior de alertas tambien sirve durante la transicion.
    validarTokenCron(tokenCabecera || tokenQuery, {
      permitirTokenAlertas: true,
    });
    return this.automatizaciones.ejecutar('revision_consistencia', () =>
      this.service.registrarHallazgos(),
    );
  }
}
