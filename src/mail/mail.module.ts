import { Module } from '@nestjs/common';
import { NotificacionesConfigModule } from '../config/notificaciones.module';
import { MailService } from './mail.service';

@Module({
  imports: [NotificacionesConfigModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}