import { Module } from '@nestjs/common';
import { ProduccionController } from './produccion.controller';
import { ProduccionService } from './produccion.service';
import { PrismaModule } from 'src/prisma.module';

@Module({
  controllers: [ProduccionController],
  providers: [ProduccionService],
  imports: [PrismaModule]
})
export class ProduccionModule {}
