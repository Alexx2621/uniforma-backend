import { Module } from '@nestjs/common';
import { CorrelativosController } from './correlativos.controller';
import { CorrelativosService } from './correlativos.service';
import { PrismaModule } from '../prisma.module';
import { PermissionsGuard } from '../auth/permissions.guard';

@Module({
  imports: [PrismaModule],
  controllers: [CorrelativosController],
  providers: [CorrelativosService, PermissionsGuard],
})
export class CorrelativosModule {}
