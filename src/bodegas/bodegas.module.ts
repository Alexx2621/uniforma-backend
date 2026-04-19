import { Module } from '@nestjs/common';
import { BodegasController } from './bodegas.controller';
import { BodegasService } from './bodegas.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [BodegasController],
  providers: [BodegasService, PrismaService],
  exports: [BodegasService],
})
export class BodegasModule {}
