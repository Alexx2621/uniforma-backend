import { Module } from '@nestjs/common';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PrismaModule } from '../prisma.module';
import { AutorizacionesController } from './autorizaciones.controller';
import { AutorizacionesService } from './autorizaciones.service';

@Module({
  imports: [PrismaModule],
  controllers: [AutorizacionesController],
  providers: [AutorizacionesService, PermissionsGuard],
})
export class AutorizacionesModule {}
