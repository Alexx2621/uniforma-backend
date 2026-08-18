import { Module } from '@nestjs/common';
import { VentasService } from './ventas.service';
import { VentasController } from './ventas.controller';
import { PrismaModule } from '../prisma.module';
import { CorrelativosModule } from '../correlativos/correlativos.module';
import { AlertasModule } from '../alertas/alertas.module';

@Module({
  imports: [PrismaModule, CorrelativosModule, AlertasModule],
  providers: [VentasService],
  controllers: [VentasController],
  exports: [VentasService],
})
export class VentasModule {}
