type RuntimeEnvironment = Record<string, string | undefined>;

/**
 * Red de seguridad para cPanel. El panel puede regenerar las variables al
 * guardar y quitar silenciosamente los limites de Prisma. Sin connection_limit
 * el cliente usa los nucleos fisicos del servidor compartido y abre casi todas
 * las conexiones MySQL disponibles para la cuenta.
 */
export function aplicarLimitesDeProduccion(
  env: RuntimeEnvironment = process.env,
) {
  if (`${env.NODE_ENV || ''}`.toLowerCase() !== 'production') return;

  env.UV_THREADPOOL_SIZE ||= '2';
  env.TOKIO_WORKER_THREADS ||= '2';
  env.RAYON_NUM_THREADS ||= '2';

  const databaseUrl = `${env.DATABASE_URL || ''}`.trim();
  if (!databaseUrl || !/^mysql:/i.test(databaseUrl)) return;

  const parametros: string[] = [];
  if (!/[?&]connection_limit=/i.test(databaseUrl)) {
    parametros.push('connection_limit=2');
  }
  if (!/[?&]pool_timeout=/i.test(databaseUrl)) {
    parametros.push('pool_timeout=10');
  }
  if (!parametros.length) return;

  env.DATABASE_URL = `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}${parametros.join('&')}`;
}
