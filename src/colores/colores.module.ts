import { Module } from '@nestjs/common';
import { ColoresService } from './colores.service';
import { ColoresController } from './colores.controller';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ColoresService],
  controllers: [ColoresController],
})
export class ColoresModule {}
