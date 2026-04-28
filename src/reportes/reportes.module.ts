import { Module } from '@nestjs/common';
import { NotificacionesConfigModule } from '../config/notificaciones.module';
import { ReportesService } from './reportes.service';

@Module({
  imports: [NotificacionesConfigModule],
  providers: [ReportesService],
  exports: [ReportesService],
})
export class ReportesModule {}
