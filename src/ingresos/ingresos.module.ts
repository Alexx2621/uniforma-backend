import { Module } from '@nestjs/common';
import { IngresosService } from './ingresos.service';
import { IngresosController } from './ingresos.controller';
import { PrismaModule } from '../prisma.module';
import { CorrelativosModule } from '../correlativos/correlativos.module';

@Module({
  imports: [PrismaModule, CorrelativosModule],
  providers: [IngresosService],
  controllers: [IngresosController],
})
export class IngresosModule {}
