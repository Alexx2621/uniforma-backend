import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type CategoriaCreateData = {
  nombre: string;
  descripcion?: string | null;
  [key: string]: unknown;
};

type CategoriaUpdateData = Partial<CategoriaCreateData>;

@Injectable()
export class CategoriasService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.categoria.findMany();
  }

  findOne(id: number) {
    return this.prisma.categoria.findUnique({
      where: { id },
    });
  }

  create(data: CategoriaCreateData) {
    return this.prisma.categoria.create({
      data,
    });
  }

  update(id: number, data: CategoriaUpdateData) {
    return this.prisma.categoria.update({
      where: { id },
      data,
    });
  }

  delete(id: number) {
    return this.prisma.categoria.delete({
      where: { id },
    });
  }
}
