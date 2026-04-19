import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsuariosService {
  constructor(private prisma: PrismaService) {}

  async createUser(data) {
    const hashed = await bcrypt.hash(data.password, 10);

    return this.prisma.usuario.create({
      data: {
        nombre: data.nombre,
        usuario: data.usuario,
        correo: data.correo,
        password: hashed,
        rolId: data.rolId,
        bodegaId: data.bodegaId,
      },
    });
  }

  findAll() {
    return this.prisma.usuario.findMany({
      include: { rol: true, bodega: true },
    });
  }

  findOne(id: number) {
    return this.prisma.usuario.findUnique({
      where: { id },
      include: { rol: true, bodega: true },
    });
  }

  async update(id: number, data: any) {
    const payload: any = {
      nombre: data.nombre,
      usuario: data.usuario,
      correo: data.correo,
      rolId: data.rolId,
      bodegaId: data.bodegaId,
    };
    if (data.password) {
      payload.password = await bcrypt.hash(data.password, 10);
    }
    return this.prisma.usuario.update({
      where: { id },
      data: payload,
    });
  }

  remove(id: number) {
    return this.prisma.usuario.delete({ where: { id } });
  }
}
