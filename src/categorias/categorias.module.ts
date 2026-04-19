import { Module } from '@nestjs/common';
import { CategoriasService } from './categorias.service';
import { CategoriasController } from './categorias.controller';
import { PrismaModule } from '../prisma.module'; 

@Module({
  imports: [PrismaModule],  
  providers: [CategoriasService],
  controllers: [CategoriasController]
})
export class CategoriasModule {}
