import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { MailModule } from '../mail/mail.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
