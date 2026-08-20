import { aplicarLimitesDeProduccion } from './production-resource-limits';

describe('aplicarLimitesDeProduccion', () => {
  it('limita conexiones e hilos cuando cPanel pierde los parametros', () => {
    const env: Record<string, string | undefined> = {
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://usuario:clave@localhost:3306/uniforma',
    };

    aplicarLimitesDeProduccion(env);

    expect(env.DATABASE_URL).toBe(
      'mysql://usuario:clave@localhost:3306/uniforma?connection_limit=2&pool_timeout=10',
    );
    expect(env.UV_THREADPOOL_SIZE).toBe('2');
    expect(env.TOKIO_WORKER_THREADS).toBe('2');
    expect(env.RAYON_NUM_THREADS).toBe('2');
  });

  it('conserva limites configurados explicitamente', () => {
    const env: Record<string, string | undefined> = {
      NODE_ENV: 'production',
      DATABASE_URL:
        'mysql://usuario:clave@localhost:3306/uniforma?connection_limit=3&pool_timeout=15',
      UV_THREADPOOL_SIZE: '3',
    };

    aplicarLimitesDeProduccion(env);

    expect(env.DATABASE_URL).toContain('connection_limit=3');
    expect(env.DATABASE_URL).toContain('pool_timeout=15');
    expect(env.UV_THREADPOOL_SIZE).toBe('3');
  });

  it('no modifica el entorno de desarrollo', () => {
    const env: Record<string, string | undefined> = {
      NODE_ENV: 'development',
      DATABASE_URL: 'mysql://usuario:clave@localhost:3306/uniforma',
    };

    aplicarLimitesDeProduccion(env);

    expect(env.DATABASE_URL).not.toContain('connection_limit');
  });
});
