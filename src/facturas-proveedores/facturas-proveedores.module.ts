import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { FacturasProveedoresController } from './facturas-proveedores.controller';
import { FacturasProveedoresService } from './facturas-proveedores.service';

@Module({
  imports: [PrismaModule],
  controllers: [FacturasProveedoresController],
  providers: [FacturasProveedoresService],
})
export class FacturasProveedoresModule {}
