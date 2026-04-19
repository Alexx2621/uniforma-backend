import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.rol.findMany({
      include: { permisos: { include: { permiso: true } } }
    });
  }

  findOne(id: number) {
    return this.prisma.rol.findUnique({
      where: { id },
      include: { permisos: { include: { permiso: true } } }
    });
  }

  create(data: any) {
    return this.prisma.rol.create({
      data: {
        nombre: data.nombre,
        descripcion: data.descripcion,
      },
    });
  }
}
