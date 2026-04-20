import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.get<string[]>('permissions', context.getHandler());

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('No tienes permisos para acceder');
    }

    const currentUser = await this.prisma.usuario.findUnique({
      where: { id: Number(user.id) },
      include: {
        rol: {
          include: {
            permisos: {
              include: { permiso: true },
            },
          },
        },
      },
    });

    if (!currentUser?.rol) {
      throw new ForbiddenException('No tienes permisos para acceder');
    }

    const currentPermissions = currentUser.rol.permisos.map((item) => item.permiso.nombre);

    request.user = {
      ...request.user,
      rol: currentUser.rol.nombre,
      rolId: currentUser.rolId,
      permisos: currentPermissions,
      bodegaId: currentUser.bodegaId ?? null,
    };

    if (currentUser.rol.nombre === 'ADMIN') {
      return true;
    }

    const allowed = requiredPermissions.every((permission) => currentPermissions.includes(permission));

    if (!allowed) {
      throw new ForbiddenException('No tienes permisos para acceder');
    }

    return true;
  }
}
