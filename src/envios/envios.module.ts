import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { EnviosController } from './envios.controller';
import { EnviosService } from './envios.service';

@Module({
  imports: [PrismaModule],
  controllers: [EnviosController],
  providers: [EnviosService],
})
export class EnviosModule {}
