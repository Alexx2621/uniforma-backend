import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AlertasController } from './alertas.controller';
import { AlertasService } from './alertas.service';
import { AlertasGateway } from './alertas.gateway';

@Module({
  imports: [PrismaModule],
  controllers: [AlertasController],
  providers: [AlertasService, AlertasGateway],
  exports: [AlertasService],
})
export class AlertasModule {}
