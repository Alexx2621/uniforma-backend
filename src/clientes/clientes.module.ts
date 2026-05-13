import { Module } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { ClientesController } from './clientes.controller';
import { PrismaModule } from '../prisma.module';
import { PermissionsGuard } from '../auth/permissions.guard';

@Module({
  imports: [PrismaModule],
  providers: [ClientesService, PermissionsGuard],
  controllers: [ClientesController],
})
export class ClientesModule {}
