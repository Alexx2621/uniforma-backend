import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { join } from 'path';
import * as express from 'express';

/**
 * Un panic del motor de Prisma ("PANIC: timer has gone away") llega como
 * excepcion no capturada y mata el proceso. El 17/08/2026 eso encadeno 564
 * reinicios seguidos que agotaron el limite de procesos de la cuenta
 * (lvenproc 100/100) y dejaron sin servicio incluso al sitio corporativo, que
 * no tiene nada que ver con esta aplicacion.
 *
 * Mantener vivo un proceso tras una excepcion no capturada no es lo habitual,
 * y se hace aqui a proposito: en este hosting el coste de morir en bucle es
 * mucho mayor que el de seguir con un estado posiblemente degradado. Si el
 * motor quedo inservible, las peticiones devolveran 500 y se vera en el
 * registro, pero el resto de la cuenta sigue en pie.
 */
function instalarRedDeSeguridad() {
  process.on('uncaughtException', (error) => {
    console.error('[uncaughtException] La aplicacion sigue en pie:', error);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection] La aplicacion sigue en pie:', reason);
  });
}

/**
 * Cierre ordenado cuando Passenger retira la instancia.
 *
 * Sin esto la instancia vieja no moria nunca: Passenger manda SIGTERM y espera
 * a que el proceso cierre solo, pero el gateway de alertas mantiene conexiones
 * WebSocket abiertas de forma permanente y esas nunca drenan. El resultado era
 * que cada despliegue dejaba una instancia huerfana viva; el 19/08/2026 se
 * encontraron cuatro a la vez consumiendo 76 de los 100 procesos de la cuenta,
 * lo que rompia los despliegues y tumbaba los sitios.
 *
 * El temporizador de gracia es la pieza clave: si a los 8 segundos todavia hay
 * sockets abiertos, se sale igual. Es preferible cortar una conexion en curso
 * que dejar un proceso zombi ocupando cupo indefinidamente.
 */
function instalarApagadoOrdenado(app: { close: () => Promise<void> }) {
  let cerrando = false;

  const apagar = async (senal: string) => {
    if (cerrando) return;
    cerrando = true;
    console.log(`[${senal}] Cerrando la aplicacion...`);

    const salidaForzada = setTimeout(() => {
      console.error(`[${senal}] Cierre forzado: quedaban conexiones abiertas.`);
      process.exit(0);
    }, 8000);
    salidaForzada.unref();

    try {
      await app.close();
    } catch (error) {
      console.error(`[${senal}] Fallo el cierre ordenado:`, error);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void apagar('SIGTERM'));
  process.on('SIGINT', () => void apagar('SIGINT'));
}

async function bootstrap() {
  instalarRedDeSeguridad();

  const app = await NestFactory.create(AppModule);
  // Permite que onModuleDestroy corra de verdad (limpia el intervalo de alertas
  // y cierra las conexiones de Prisma) en vez de morir sin soltar nada.
  app.enableShutdownHooks();
  instalarApagadoOrdenado(app);
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ limit: '25mb', extended: true }));

  app.enableCors({
    origin: true,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

  app.use('/storage', express.static(join(process.cwd(), 'storage')));
  app.use('/assets', express.static(join(process.cwd(), 'src', 'assets')));

  await app.listen(port, '0.0.0.0');
}
bootstrap();
