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

async function bootstrap() {
  instalarRedDeSeguridad();

  const app = await NestFactory.create(AppModule);
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
