import { Module } from '@nestjs/common';
import { TrasladosService } from './traslados.service';
import { TrasladosController } from './traslados.controller';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [TrasladosService],
  controllers: [TrasladosController],
})
export class TrasladosModule {}
