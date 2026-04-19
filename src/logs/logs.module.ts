import { Module } from '@nestjs/common';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { PrismaModule } from 'src/prisma.module';

@Module({
  controllers: [LogsController],
  providers: [LogsService],
  imports: [PrismaModule]
})
export class LogsModule {}
