import { Module } from '@nestjs/common';
import { VentasService } from './ventas.service';
import { VentasController } from './ventas.controller';
import { VentasEspecialesService } from './ventas-especiales.service';
import { VentasEspecialesController } from './ventas-especiales.controller';
import { PrismaModule } from '../prisma.module';
import { CorrelativosModule } from '../correlativos/correlativos.module';
import { AlertasModule } from '../alertas/alertas.module';

@Module({
  imports: [PrismaModule, CorrelativosModule, AlertasModule],
  providers: [VentasService, VentasEspecialesService],
  controllers: [VentasController, VentasEspecialesController],
  exports: [VentasService, VentasEspecialesService],
})
export class VentasModule {}
