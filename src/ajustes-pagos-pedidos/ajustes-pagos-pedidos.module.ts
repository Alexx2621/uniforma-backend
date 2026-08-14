import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AjustesPagosPedidosController } from './ajustes-pagos-pedidos.controller';
import { AjustesPagosPedidosService } from './ajustes-pagos-pedidos.service';

@Module({
  imports: [PrismaModule],
  controllers: [AjustesPagosPedidosController],
  providers: [AjustesPagosPedidosService],
  exports: [AjustesPagosPedidosService],
})
export class AjustesPagosPedidosModule {}
