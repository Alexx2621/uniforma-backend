import { Module } from '@nestjs/common';
import { TallasService } from './tallas.service';
import { TallasController } from './tallas.controller';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [TallasService],
  controllers: [TallasController],
})
export class TallasModule {}
