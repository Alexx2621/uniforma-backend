import { Module } from '@nestjs/common';
import { TrasladosService } from './traslados.service';
import { TrasladosController } from './traslados.controller';
import { PrismaModule } from '../prisma.module';
import { CorrelativosModule } from '../correlativos/correlativos.module';
import { AlertasModule } from '../alertas/alertas.module';

@Module({
  imports: [PrismaModule, CorrelativosModule, AlertasModule],
  providers: [TrasladosService],
  controllers: [TrasladosController],
})
export class TrasladosModule {}
