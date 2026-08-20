import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { StatusModule } from '../status/status.module';
import { AlertasModule } from '../alertas/alertas.module';
import { ConsistenciaController } from './consistencia.controller';
import { ConsistenciaService } from './consistencia.service';
import { AnalizadorService } from './analizador.service';
import { IntencionService } from './intencion.service';
import { BorradorService } from './borrador.service';
import { ConsistenciaCronController } from './consistencia-cron.controller';
import { AutomatizacionesModule } from '../automatizaciones/automatizaciones.module';

@Module({
  imports: [PrismaModule, StatusModule, AlertasModule, AutomatizacionesModule],
  controllers: [ConsistenciaController, ConsistenciaCronController],
  providers: [
    ConsistenciaService,
    AnalizadorService,
    IntencionService,
    BorradorService,
  ],
  exports: [
    ConsistenciaService,
    AnalizadorService,
    IntencionService,
    BorradorService,
  ],
})
export class ConsistenciaModule {}
