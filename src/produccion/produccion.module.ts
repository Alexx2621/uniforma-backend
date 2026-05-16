import { Module } from '@nestjs/common';
import { ProduccionController } from './produccion.controller';
import { ProduccionService } from './produccion.service';
import { PrismaModule } from 'src/prisma.module';
import { AlertasModule } from '../alertas/alertas.module';
import { ProduccionGateway } from './produccion.gateway';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  controllers: [ProduccionController],
  providers: [ProduccionService, ProduccionGateway],
  imports: [PrismaModule, AlertasModule, TrackingModule]
})
export class ProduccionModule {}
