import { Module } from '@nestjs/common';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CorrelativosModule } from '../correlativos/correlativos.module';
import { PrismaModule } from '../prisma.module';
import { PostventaController } from './postventa.controller';
import { PostventaService } from './postventa.service';

@Module({
  imports: [PrismaModule, CorrelativosModule],
  controllers: [PostventaController],
  providers: [PostventaService, PermissionsGuard],
})
export class PostventaModule {}
