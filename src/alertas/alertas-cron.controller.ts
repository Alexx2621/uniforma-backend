import { Controller, ForbiddenException, Headers, Post, Query } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
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
  constructor(private readonly service: AlertasService) {}

  @Post('programadas')
  async ejecutarProgramadas(
    @Headers('x-cron-token') tokenCabecera?: string,
    @Query('token') tokenQuery?: string,
  ) {
    const esperado = process.env.ALERTAS_CRON_TOKEN;
    if (!esperado) {
      throw new ForbiddenException('ALERTAS_CRON_TOKEN no esta configurado');
    }

    if (!this.tokenValido(tokenCabecera || tokenQuery, esperado)) {
      throw new ForbiddenException('Token de cron invalido');
    }

    await this.service.emitirAlertasProgramadasVencidas();
    return { ok: true, ejecutadoEn: new Date().toISOString() };
  }

  /** Comparacion de tiempo constante: evita filtrar el token por latencia. */
  private tokenValido(recibido: string | undefined, esperado: string) {
    if (!recibido) return false;
    const a = Buffer.from(recibido);
    const b = Buffer.from(esperado);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
