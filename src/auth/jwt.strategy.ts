import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: 'MI_SECRETO_SUPER_SEGURO',
    });
  }

  async validate(payload: any) {
    let invalidatedAt = 0;

    try {
      const config = await this.prisma.notificacionConfig.findUnique({
        where: { id: 1 },
        select: { sessionInvalidatedAt: true },
      });
      invalidatedAt = config?.sessionInvalidatedAt?.getTime() || 0;
    } catch (error: any) {
      if (error?.code !== 'P2022') {
        throw error;
      }
    }

    const tokenIssuedAt = Number(payload.iat || 0) * 1000;

    if (invalidatedAt && tokenIssuedAt && tokenIssuedAt < invalidatedAt) {
      throw new UnauthorizedException('Sesion expirada por actualizacion del sistema');
    }

    return {
      id: payload.sub,
      usuario: payload.usuario,
      correo: payload.correo,
      usuarioCorrelativo: payload.usuarioCorrelativo,
      rol: payload.rol,
      permisos: payload.permisos ?? [],
    };
  }
}
