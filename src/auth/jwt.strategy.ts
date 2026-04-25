import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: 'MI_SECRETO_SUPER_SEGURO',
    });
  }

  async validate(payload: any) {
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
