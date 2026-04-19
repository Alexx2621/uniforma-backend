import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(correo: string, password: string) {
    const user = await this.prisma.usuario.findUnique({
      where: { correo },
      include: {
        rol: {
          include: {
            permisos: {
              include: { permiso: true },
            },
          },
        },
        bodega: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    const passwordValid = await bcrypt.compare(password, user.password);

    if (!passwordValid) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    const payload = {
      sub: user.id,
      usuario: user.usuario,
      correo: user.correo,
      rol: user.rol.nombre,
      permisos: user.rol.permisos.map((item) => item.permiso.nombre),
      bodegaId: user.bodegaId ?? null,
    };

    const token = await this.jwtService.signAsync(payload);

    return {
      token,
      usuario: user.usuario,
      correo: user.correo,
      nombre: user.nombre,
      rol: user.rol.nombre,
      permisos: user.rol.permisos.map((item) => item.permiso.nombre),
      bodegaId: user.bodegaId ?? null,
      bodegaNombre: user.bodega?.nombre ?? null,
    };
  }
}
