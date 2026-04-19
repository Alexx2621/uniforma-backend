import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class TelasService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.tela.findMany();
  }

  findOne(id: number) {
    return this.prisma.tela.findUnique({
      where: { id },
    });
  }

  create(data: any) {
    return this.prisma.tela.create({
      data,
    });
  }

  update(id: number, data: any) {
    return this.prisma.tela.update({
      where: { id },
      data,
    });
  }

  delete(id: number) {
    return this.prisma.tela.delete({
      where: { id },
    });
  }
}
