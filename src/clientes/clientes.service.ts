import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ClientesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.cliente.findMany();
  }

  findOne(id: number) {
    return this.prisma.cliente.findUnique({
      where: { id },
    });
  }

  create(data: any) {
    return this.prisma.cliente.create({
      data,
    });
  }

  update(id: number, data: any) {
    return this.prisma.cliente.update({
      where: { id },
      data,
    });
  }

  delete(id: number) {
    return this.prisma.cliente.delete({
      where: { id },
    });
  }
}
