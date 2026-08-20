import { Controller, Headers, Post, Query } from '@nestjs/common';
import { AutomatizacionesService } from '../automatizaciones/automatizaciones.service';
import { validarTokenCron } from '../common/cron-auth';
import { AlertasService } from './alertas.service';

/**
 * Disparador externo del barrido de alertas programadas.
 *
 * En Railway el proceso vivia indefinidamente y bastaba el setInterval de
 * AlertasService. Bajo Passenger (cPanel) la aplicacion se duerme cuando no
 * hay trafico, asi que el intervalo deja de correr. Este endpoint permite que
 * un trabajo de cron despierte la app y ejecute el barrido.
 *
 * Va fuera de AlertasController a proposito: aquel exige JWT a nivel de clase
 * y el cron no tiene sesion. Aqui la proteccion es un token compartido.
 */
@Controller('alertas-cron')
export class AlertasCronController {
  constructor(
    private readonly service: AlertasService,
    private readonly automatizaciones: AutomatizacionesService,
  ) {}

  @Post('programadas')
  async ejecutarProgramadas(
    @Headers('x-cron-token') tokenCabecera?: string,
    @Query('token') tokenQuery?: string,
  ) {
    validarTokenCron(tokenCabecera || tokenQuery, {
      permitirTokenAlertas: true,
    });
    return this.automatizaciones.ejecutar('alertas_programadas', () =>
      this.service.emitirAlertasProgramadasVencidas(),
    );
  }
}
