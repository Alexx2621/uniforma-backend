import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { CorreccionesController } from './correcciones.controller';
import { CorreccionesService } from './correcciones.service';

@Module({
  imports: [PrismaModule],
  controllers: [CorreccionesController],
  providers: [CorreccionesService],
})
export class CorreccionesModule {}
