import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.get<string[]>('permissions', context.getHandler());

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('No tienes permisos para acceder');
    }

    if (user.rol === 'ADMIN') {
      return true;
    }

    const userPermissions = Array.isArray(user.permisos) ? user.permisos : [];
    const allowed = requiredPermissions.every((permission) => userPermissions.includes(permission));

    if (!allowed) {
      throw new ForbiddenException('No tienes permisos para acceder');
    }

    return true;
  }
}
