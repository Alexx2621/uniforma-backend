import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ColoresService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.color.findMany();
  }

  findOne(id: number) {
    return this.prisma.color.findUnique({
      where: { id },
    });
  }

  create(data: any) {
    return this.prisma.color.create({
      data,
    });
  }

  update(id: number, data: any) {
    return this.prisma.color.update({
      where: { id },
      data,
    });
  }

  delete(id: number) {
    return this.prisma.color.delete({
      where: { id },
    });
  }
}
