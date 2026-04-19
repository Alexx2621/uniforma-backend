import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Leer roles requeridos del decorador
    const requiredRoles = this.reflector.get<string[]>('roles', context.getHandler());

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // si no se necesita rol → pasa
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user; // viene del JWT

    if (!user || !requiredRoles.includes(user.rol)) {
      throw new ForbiddenException('No tienes permisos para acceder');
    }

    return true;
  }
}
