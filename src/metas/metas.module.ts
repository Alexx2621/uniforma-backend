import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { MetasController } from './metas.controller';
import { MetasService } from './metas.service';

@Module({
  imports: [PrismaModule],
  controllers: [MetasController],
  providers: [MetasService],
})
export class MetasModule {}
