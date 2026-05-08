import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { CorrelativosModule } from '../correlativos/correlativos.module';
import { ReportesModule } from '../reportes/reportes.module';
import { NotificacionesConfigModule } from '../config/notificaciones.module';
import { DocumentosController } from './documentos.controller';
import { DocumentosService } from './documentos.service';

@Module({
  imports: [PrismaModule, CorrelativosModule, ReportesModule, NotificacionesConfigModule],
  controllers: [DocumentosController],
  providers: [DocumentosService],
})
export class DocumentosModule {}
