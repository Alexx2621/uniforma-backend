import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { StatusModule } from '../status/status.module';
import { AlertasModule } from '../alertas/alertas.module';
import { ConsistenciaController } from './consistencia.controller';
import { ConsistenciaService } from './consistencia.service';
import { AnalizadorService } from './analizador.service';
import { IntencionService } from './intencion.service';
import { BorradorService } from './borrador.service';

@Module({
  imports: [PrismaModule, StatusModule, AlertasModule],
  controllers: [ConsistenciaController],
  providers: [ConsistenciaService, AnalizadorService, IntencionService, BorradorService],
  exports: [ConsistenciaService, AnalizadorService, IntencionService, BorradorService],
})
export class ConsistenciaModule {}
