import { Module } from '@nestjs/common';
import { TelasService } from './telas.service';
import { TelasController } from './telas.controller';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [TelasService],
  controllers: [TelasController],
})
export class TelasModule {}
