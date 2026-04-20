import { Module } from '@nestjs/common';
import { ProduccionController } from './produccion.controller';
import { ProduccionService } from './produccion.service';
import { PrismaModule } from 'src/prisma.module';
import { AlertasModule } from '../alertas/alertas.module';

@Module({
  controllers: [ProduccionController],
  providers: [ProduccionService],
  imports: [PrismaModule, AlertasModule]
})
export class ProduccionModule {}
