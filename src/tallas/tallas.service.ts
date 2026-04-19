import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class TallasService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.talla.findMany();
  }

  findOne(id: number) {
    return this.prisma.talla.findUnique({
      where: { id },
    });
  }

  create(data: any) {
    return this.prisma.talla.create({
      data,
    });
  }

  update(id: number, data: any) {
    return this.prisma.talla.update({
      where: { id },
      data,
    });
  }

  delete(id: number) {
    return this.prisma.talla.delete({
      where: { id },
    });
  }
}
