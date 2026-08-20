import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AlertasController } from './alertas.controller';
import { AlertasCronController } from './alertas-cron.controller';
import { AlertasService } from './alertas.service';
import { AlertasGateway } from './alertas.gateway';
import { AutomatizacionesModule } from '../automatizaciones/automatizaciones.module';

@Module({
  imports: [PrismaModule, AutomatizacionesModule],
  controllers: [AlertasController, AlertasCronController],
  providers: [AlertasService, AlertasGateway],
  exports: [AlertasService],
})
export class AlertasModule {}
