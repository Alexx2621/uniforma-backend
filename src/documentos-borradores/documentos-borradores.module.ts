import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { DocumentosBorradoresController } from './documentos-borradores.controller';
import { DocumentosBorradoresService } from './documentos-borradores.service';

@Module({
  imports: [PrismaModule],
  controllers: [DocumentosBorradoresController],
  providers: [DocumentosBorradoresService],
})
export class DocumentosBorradoresModule {}
