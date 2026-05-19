import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { RelacionesController } from './relaciones.controller';
import { RelacionesService } from './relaciones.service';

@Module({
  imports: [PrismaModule],
  controllers: [RelacionesController],
  providers: [RelacionesService],
})
export class RelacionesModule {}
