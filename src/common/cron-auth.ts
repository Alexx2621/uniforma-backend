import { ForbiddenException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

function coincideEnTiempoConstante(recibido: string, esperado: string) {
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Autoriza llamadas sin sesion provenientes de cPanel. El token general
 * permite rotar ambos cron juntos; ALERTAS_CRON_TOKEN se conserva para no
 * romper la automatizacion que ya existia.
 */
export function validarTokenCron(
  recibido?: string,
  opciones: { permitirTokenAlertas?: boolean } = {},
) {
  const esperados = [process.env.OPERACIONES_CRON_TOKEN];
  if (opciones.permitirTokenAlertas) {
    esperados.push(process.env.ALERTAS_CRON_TOKEN);
  }

  const configurados = esperados
    .map((token) => `${token || ''}`.trim())
    .filter(Boolean);

  if (!configurados.length) {
    throw new ForbiddenException(
      opciones.permitirTokenAlertas
        ? 'OPERACIONES_CRON_TOKEN o ALERTAS_CRON_TOKEN no esta configurado'
        : 'OPERACIONES_CRON_TOKEN no esta configurado',
    );
  }

  const valor = `${recibido || ''}`;
  if (
    !valor ||
    !configurados.some((token) => coincideEnTiempoConstante(valor, token))
  ) {
    throw new ForbiddenException('Token de cron invalido');
  }
}
