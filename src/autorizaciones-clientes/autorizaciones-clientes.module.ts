import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AlertasModule } from '../alertas/alertas.module';
import { AutorizacionesClientesController } from './autorizaciones-clientes.controller';
import { AutorizacionesClientesService } from './autorizaciones-clientes.service';

@Module({
  // AlertasModule es necesario para avisar al vendedor propietario cuando
  // alguien solicita autorizacion sobre un cliente de su cartera.
  imports: [PrismaModule, AlertasModule],
  controllers: [AutorizacionesClientesController],
  providers: [AutorizacionesClientesService],
})
export class AutorizacionesClientesModule {}
