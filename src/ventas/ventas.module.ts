import { Module } from '@nestjs/common';
import { VentasService } from './ventas.service';
import { VentasController } from './ventas.controller';
import { PrismaModule } from '../prisma.module';
import { CorrelativosModule } from '../correlativos/correlativos.module';

@Module({
  imports: [PrismaModule, CorrelativosModule],
  providers: [VentasService],
  controllers: [VentasController],
})
export class VentasModule {}
