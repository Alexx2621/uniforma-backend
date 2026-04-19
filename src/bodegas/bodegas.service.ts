import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class BodegasService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.bodega.findMany();
  }

  create(data: { nombre: string; ubicacion?: string | null }) {
    return this.prisma.bodega.create({ data: { nombre: data.nombre, ubicacion: data.ubicacion || null } });
  }

  update(id: number, data: { nombre: string; ubicacion?: string | null }) {
    return this.prisma.bodega.update({
      where: { id },
      data: { nombre: data.nombre, ubicacion: data.ubicacion || null },
    });
  }

  remove(id: number) {
    return this.prisma.bodega.delete({ where: { id } });
  }
}
