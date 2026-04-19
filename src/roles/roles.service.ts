import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PERMISSION_CATALOG } from './permission-catalog';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  private async ensurePermissionCatalog() {
    for (const permission of PERMISSION_CATALOG) {
      const existing = await this.prisma.permiso.findFirst({
        where: { nombre: permission.key },
      });

      if (!existing) {
        await this.prisma.permiso.create({
          data: {
            nombre: permission.key,
            descripcion: permission.description,
          },
        });
      }
    }
  }

  private async resolvePermissionIds(permissionNames: string[]) {
    await this.ensurePermissionCatalog();

    if (!permissionNames.length) return [];

    const permissions = await this.prisma.permiso.findMany({
      where: {
        nombre: {
          in: permissionNames,
        },
      },
    });

    return permissions.map((permission) => permission.id);
  }

  async findAll() {
    await this.ensurePermissionCatalog();
    return this.prisma.rol.findMany({
      include: { permisos: { include: { permiso: true } } }
    });
  }

  async findOne(id: number) {
    await this.ensurePermissionCatalog();
    return this.prisma.rol.findUnique({
      where: { id },
      include: { permisos: { include: { permiso: true } } }
    });
  }

  getPermissionCatalog() {
    return PERMISSION_CATALOG;
  }

  async create(data: any) {
    const nombre = `${data?.nombre ?? ''}`.trim();
    if (!nombre) {
      throw new ConflictException('El nombre del rol es obligatorio');
    }

    const permissionIds = await this.resolvePermissionIds(Array.isArray(data?.permisos) ? data.permisos : []);

    return this.prisma.rol.create({
      data: {
        nombre,
        descripcion: data.descripcion?.trim() || null,
        permisos: permissionIds.length
          ? {
              create: permissionIds.map((permisoId) => ({ permisoId })),
            }
          : undefined,
      },
      include: { permisos: { include: { permiso: true } } },
    });
  }

  async update(id: number, data: any) {
    const permissionIds = await this.resolvePermissionIds(Array.isArray(data?.permisos) ? data.permisos : []);

    return this.prisma.rol.update({
      where: { id },
      data: {
        descripcion: data.descripcion?.trim() || null,
        permisos: {
          deleteMany: {},
          ...(permissionIds.length
            ? {
                create: permissionIds.map((permisoId) => ({ permisoId })),
              }
            : {}),
        },
      },
      include: { permisos: { include: { permiso: true } } },
    });
  }

  remove(id: number) {
    return this.prisma.rol.delete({
      where: { id },
    });
  }
}
