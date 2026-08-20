import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AutomatizacionesService } from './automatizaciones.service';

@Module({
  imports: [PrismaModule],
  providers: [AutomatizacionesService],
  exports: [AutomatizacionesService],
})
export class AutomatizacionesModule {}
