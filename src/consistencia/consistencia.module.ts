import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { StatusModule } from '../status/status.module';
import { AlertasModule } from '../alertas/alertas.module';
import { ConsistenciaController } from './consistencia.controller';
import { ConsistenciaService } from './consistencia.service';
import { AnalizadorService } from './analizador.service';
import { IntencionService } from './intencion.service';

@Module({
  imports: [PrismaModule, StatusModule, AlertasModule],
  controllers: [ConsistenciaController],
  providers: [ConsistenciaService, AnalizadorService, IntencionService],
  exports: [ConsistenciaService, AnalizadorService, IntencionService],
})
export class ConsistenciaModule {}
