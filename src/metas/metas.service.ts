import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

interface AuthUser {
  id?: number;
  rol?: string | null;
  permisos?: string[] | null;
  bodegaId?: number | string | null;
}

interface MetaMensualPayload {
  year?: number | string;
  month?: number | string;
  bodegaId?: number | string | null;
  usuarioId?: number | string | null;
  metaMes?: number | string;
  promedioDiario?: number | string | null;
  observaciones?: string | null;
}

interface MetaMensualQuery {
  year?: string;
  month?: string;
  bodegaId?: string;
  usuarioId?: string;
}

const normalizeOptionalInt = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException('Identificador no valido');
  }
  return parsed;
};

const normalizeNumber = (value: unknown, field: string) => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestException(`${field} no valido`);
  }
  return parsed;
};

@Injectable()
export class MetasService {
  constructor(private prisma: PrismaService) {}

  private isAdmin(user?: AuthUser) {
    return `${user?.rol || ''}`.trim().toUpperCase() === 'ADMIN';
  }

  private hasPermission(user: AuthUser | undefined, permission: string) {
    return Boolean(user?.permisos?.includes(permission));
  }

  private canManage(user?: AuthUser) {
    return this.isAdmin(user) || this.hasPermission(user, 'metas.manage');
  }

  private canViewAll(user?: AuthUser) {
    return this.canManage(user) || this.hasPermission(user, 'metas.view') || this.hasPermission(user, 'sistema.multi-tienda');
  }

  private buildScope(year: number, month: number, bodegaId?: number | null, usuarioId?: number | null) {
    return `${year}-${month}-${bodegaId || 0}-${usuarioId || 0}`;
  }

  private normalizeYearMonth(yearValue: unknown, monthValue: unknown) {
    const year = Number(yearValue);
    const month = Number(monthValue);

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Anio no valido');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('Mes no valido');
    }

    return { year, month };
  }

  private async getCurrentUser(authUser?: AuthUser) {
    const id = Number(authUser?.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('No se pudo identificar el usuario');
    }

    const currentUser = await this.prisma.usuario.findUnique({
      where: { id },
      select: { id: true, bodegaId: true },
    });

    if (!currentUser) {
      throw new BadRequestException('No se pudo identificar el usuario');
    }

    return currentUser;
  }

  async listar(authUser: AuthUser | undefined, query: MetaMensualQuery) {
    const where: any = {};

    if (query.year) where.year = Number(query.year);
    if (query.month) where.month = Number(query.month);
    if (query.bodegaId) where.bodegaId = Number(query.bodegaId);
    if (query.usuarioId) where.usuarioId = Number(query.usuarioId);

    if (!this.canViewAll(authUser)) {
      const currentUser = await this.getCurrentUser(authUser);
      where.OR = [
        { usuarioId: currentUser.id },
        { usuarioId: null, bodegaId: currentUser.bodegaId ?? -1 },
        { usuarioId: null, bodegaId: null },
      ];
    }

    return this.prisma.metaMensual.findMany({
      where,
      include: {
        bodega: { select: { id: true, nombre: true } },
        usuario: { select: { id: true, nombre: true, usuario: true, bodegaId: true } },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { bodegaId: 'asc' }, { usuarioId: 'asc' }],
    });
  }

  async resolverActual(authUser: AuthUser | undefined, query: MetaMensualQuery) {
    const { year, month } = this.normalizeYearMonth(query.year, query.month);
    const currentUser = await this.getCurrentUser(authUser);
    const requestedUsuarioId = normalizeOptionalInt(query.usuarioId);
    const requestedBodegaId = normalizeOptionalInt(query.bodegaId);
    const canSelectScope =
      this.isAdmin(authUser) ||
      this.hasPermission(authUser, 'metas.view') ||
      this.hasPermission(authUser, 'metas.manage') ||
      this.hasPermission(authUser, 'sistema.selector-vendedores') ||
      this.hasPermission(authUser, 'sistema.multi-tienda');

    const usuarioId = canSelectScope ? requestedUsuarioId || currentUser.id : currentUser.id;
    let bodegaId = canSelectScope ? requestedBodegaId ?? currentUser.bodegaId ?? null : currentUser.bodegaId ?? null;

    if (usuarioId) {
      const usuario = await this.prisma.usuario.findUnique({
        where: { id: usuarioId },
        select: { bodegaId: true },
      });
      if (usuario?.bodegaId && !requestedBodegaId) {
        bodegaId = usuario.bodegaId;
      }
    }

    const candidates = await this.prisma.metaMensual.findMany({
      where: {
        year,
        month,
        OR: [
          { usuarioId, bodegaId },
          { usuarioId, bodegaId: null },
          { usuarioId: null, bodegaId },
          { usuarioId: null, bodegaId: null },
        ],
      },
      include: {
        bodega: { select: { id: true, nombre: true } },
        usuario: { select: { id: true, nombre: true, usuario: true, bodegaId: true } },
      },
    });

    const ordered = [
      candidates.find((meta) => meta.usuarioId === usuarioId && meta.bodegaId === bodegaId),
      candidates.find((meta) => meta.usuarioId === usuarioId && meta.bodegaId === null),
      candidates.find((meta) => meta.usuarioId === null && meta.bodegaId === bodegaId),
      candidates.find((meta) => meta.usuarioId === null && meta.bodegaId === null),
    ];
    const meta = ordered.find(Boolean) || null;

    const source = !meta
      ? 'none'
      : meta.usuarioId
        ? 'vendedor'
        : meta.bodegaId
          ? 'tienda'
          : 'global';

    return {
      metaMes: Number(meta?.metaMes || 0),
      promedioDiario: Number(meta?.promedioDiario || 0),
      source,
      meta,
    };
  }

  async guardar(authUser: AuthUser | undefined, payload: MetaMensualPayload) {
    if (!this.canManage(authUser)) {
      throw new ForbiddenException('No tienes permisos para gestionar metas');
    }

    const { year, month } = this.normalizeYearMonth(payload.year, payload.month);
    const bodegaId = normalizeOptionalInt(payload.bodegaId);
    const usuarioId = normalizeOptionalInt(payload.usuarioId);
    const metaMes = normalizeNumber(payload.metaMes, 'Meta mes');
    const promedioDiario = normalizeNumber(payload.promedioDiario, 'Promedio diario');
    const observaciones =
      typeof payload.observaciones === 'string' && payload.observaciones.trim()
        ? payload.observaciones.trim()
        : null;
    const scope = this.buildScope(year, month, bodegaId, usuarioId);

    return this.prisma.metaMensual.upsert({
      where: { scope },
      update: { year, month, bodegaId, usuarioId, metaMes, promedioDiario, observaciones },
      create: { scope, year, month, bodegaId, usuarioId, metaMes, promedioDiario, observaciones },
      include: {
        bodega: { select: { id: true, nombre: true } },
        usuario: { select: { id: true, nombre: true, usuario: true, bodegaId: true } },
      },
    });
  }

  async eliminar(authUser: AuthUser | undefined, id: number) {
    if (!this.canManage(authUser)) {
      throw new ForbiddenException('No tienes permisos para gestionar metas');
    }

    const current = await this.prisma.metaMensual.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException('Meta no encontrada');
    }

    return this.prisma.metaMensual.delete({ where: { id } });
  }
}
