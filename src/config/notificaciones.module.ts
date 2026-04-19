import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { NotificacionesConfigController } from './notificaciones.controller';
import { NotificacionesConfigService } from './notificaciones.service';

@Module({
  imports: [PrismaModule],
  controllers: [NotificacionesConfigController],
  providers: [NotificacionesConfigService],
  exports: [NotificacionesConfigService],
})
export class NotificacionesConfigModule {}
