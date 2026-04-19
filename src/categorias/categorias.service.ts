import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Prisma } from '@prisma/client';

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

  create(data: Prisma.CategoriaCreateInput) {
    return this.prisma.categoria.create({
      data,
    });
  }

  update(id: number, data: Prisma.CategoriaUpdateInput) {
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
