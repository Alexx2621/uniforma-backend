import { ForbiddenException } from '@nestjs/common';
import { validarTokenCron } from './cron-auth';

describe('validarTokenCron', () => {
  const originalGeneral = process.env.OPERACIONES_CRON_TOKEN;
  const originalAlertas = process.env.ALERTAS_CRON_TOKEN;

  afterEach(() => {
    if (originalGeneral === undefined)
      delete process.env.OPERACIONES_CRON_TOKEN;
    else process.env.OPERACIONES_CRON_TOKEN = originalGeneral;
    if (originalAlertas === undefined) delete process.env.ALERTAS_CRON_TOKEN;
    else process.env.ALERTAS_CRON_TOKEN = originalAlertas;
  });

  it('acepta el token general', () => {
    process.env.OPERACIONES_CRON_TOKEN = 'secreto-general-123';
    expect(() => validarTokenCron('secreto-general-123')).not.toThrow();
  });

  it('mantiene compatible el token anterior de alertas', () => {
    delete process.env.OPERACIONES_CRON_TOKEN;
    process.env.ALERTAS_CRON_TOKEN = 'secreto-alertas-123';
    expect(() =>
      validarTokenCron('secreto-alertas-123', { permitirTokenAlertas: true }),
    ).not.toThrow();
  });

  it('rechaza un token incorrecto', () => {
    process.env.OPERACIONES_CRON_TOKEN = 'secreto-correcto';
    expect(() => validarTokenCron('secreto-incorrecto')).toThrow(
      ForbiddenException,
    );
  });
});
