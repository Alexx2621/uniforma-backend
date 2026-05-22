import { Module } from '@nestjs/common';
import { TrasladosService } from './traslados.service';
import { TrasladosController } from './traslados.controller';
import { PrismaModule } from '../prisma.module';
import { CorrelativosModule } from '../correlativos/correlativos.module';

@Module({
  imports: [PrismaModule, CorrelativosModule],
  providers: [TrasladosService],
  controllers: [TrasladosController],
})
export class TrasladosModule {}
