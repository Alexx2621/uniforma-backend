import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { InventarioTelasController } from './inventario-telas.controller';
import { InventarioTelasService } from './inventario-telas.service';

@Module({
  imports: [PrismaModule],
  controllers: [InventarioTelasController],
  providers: [InventarioTelasService],
})
export class InventarioTelasModule {}
