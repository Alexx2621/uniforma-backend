import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type AuthUser = {
  id?: number;
  rol?: string | null;
};

const OPEN_STATUS = 'abierto';
const EXPIRED_STATUS = 'vencido';
const DRAFT_EXPIRATION_DAYS = 30;
const LOCK_MINUTES = 15;

@Injectable()
export class DocumentosBorradoresService {
  constructor(private prisma: PrismaService) {}

  private getUserId(user?: AuthUser) {
    const userId = Number(user?.id || 0);
    if (!userId) throw new ForbiddenException('Sesion no valida');
    return userId;
  }

  private normalizeTipo(value?: string | null) {
    const tipo = `${value || ''}`.trim().toLowerCase();
    if (!tipo) throw new BadRequestException('tipoDocumento es obligatorio');
    return tipo;
  }

  private normalizeJson(value: unknown): Prisma.InputJsonValue {
    if (value && typeof value === 'object') return value as Prisma.InputJsonValue;
    return {};
  }

  private getExpirationDate() {
    const date = new Date();
    date.setDate(date.getDate() - DRAFT_EXPIRATION_DAYS);
    return date;
  }

  private getLockExpirationDate() {
    const date = new Date();
    date.setMinutes(date.getMinutes() + LOCK_MINUTES);
    return date;
  }

  private async enrichRows(rows: any[]) {
    const bodegaIds = Array.from(new Set(rows.map((row) => Number(row.bodegaId || 0)).filter((id) => id > 0)));
    const clienteIds = Array.from(new Set(rows.map((row) => Number(row.clienteId || 0)).filter((id) => id > 0)));
    const bloqueadoPorIds = Array.from(new Set(rows.map((row) => Number(row.bloqueadoPorId || 0)).filter((id) => id > 0)));

    const [bodegas, clientes, bloqueadosPor] = await Promise.all([
      bodegaIds.length
        ? this.prisma.bodega.findMany({ where: { id: { in: bodegaIds } }, select: { id: true, nombre: true } })
        : Promise.resolve([]),
      clienteIds.length
        ? this.prisma.cliente.findMany({ where: { id: { in: clienteIds } }, select: { id: true, nombre: true, telefono: true } })
        : Promise.resolve([]),
      bloqueadoPorIds.length
        ? this.prisma.usuario.findMany({ where: { id: { in: bloqueadoPorIds } }, select: { id: true, nombre: true, usuario: true } })
        : Promise.resolve([]),
    ]);

    const bodegaMap = new Map<number, string>(
      bodegas.map((bodega: any) => [Number(bodega.id), `${bodega.nombre || ''}`] as [number, string]),
    );
    const clienteMap = new Map<number, any>(
      clientes.map((cliente: any) => [Number(cliente.id), cliente] as [number, any]),
    );
    const lockUserMap = new Map<number, any>(
      bloqueadosPor.map((usuario: any) => [Number(usuario.id), usuario] as [number, any]),
    );
    const now = Date.now();

    return rows.map((row) => {
      const lockUser = row.bloqueadoPorId ? lockUserMap.get(Number(row.bloqueadoPorId)) : null;
      const cliente = row.clienteId ? clienteMap.get(Number(row.clienteId)) : null;
      const bloqueadoHasta = row.bloqueadoHasta ? new Date(row.bloqueadoHasta).getTime() : 0;
      return {
        ...row,
        bodegaNombre: row.bodegaId ? bodegaMap.get(Number(row.bodegaId)) || null : null,
        clienteNombreRelacionado: cliente?.nombre || null,
        clienteTelefonoRelacionado: cliente?.telefono || null,
        bloqueadoActivo: Boolean(row.bloqueadoPorId && bloqueadoHasta > now),
        bloqueadoPorNombre: lockUser?.nombre || lockUser?.usuario || null,
      };
    });
  }

  private async expireOldDrafts(usuarioId?: number) {
    await this.prisma.documentoBorrador.updateMany({
      where: {
        estado: OPEN_STATUS,
        actualizadoEn: { lt: this.getExpirationDate() },
        ...(usuarioId ? { usuarioId } : {}),
      },
      data: { estado: EXPIRED_STATUS },
    });
  }

  async adminCleanup(user?: AuthUser) {
    if (`${user?.rol || ''}`.toUpperCase() !== 'ADMIN') {
      throw new ForbiddenException('Solo administradores pueden limpiar preliminares');
    }
    const [expired, unlocked] = await Promise.all([
      this.prisma.documentoBorrador.updateMany({
        where: {
          estado: OPEN_STATUS,
          actualizadoEn: { lt: this.getExpirationDate() },
        },
        data: { estado: EXPIRED_STATUS },
      }),
      this.prisma.documentoBorrador.updateMany({
        where: {
          estado: OPEN_STATUS,
          bloqueadoHasta: { lt: new Date() },
        },
        data: {
          bloqueadoPorId: null,
          bloqueadoEn: null,
          bloqueadoHasta: null,
        } as any,
      }),
    ]);

    return {
      vencidos: expired.count,
      bloqueosLiberados: unlocked.count,
    };
  }

  async findAll(user: AuthUser | undefined, tipoDocumento?: string) {
    const usuarioId = this.getUserId(user);
    await this.expireOldDrafts(usuarioId);
    const where: Prisma.DocumentoBorradorWhereInput = {
      usuarioId,
      estado: { in: [OPEN_STATUS, EXPIRED_STATUS] },
    };

    if (tipoDocumento) where.tipoDocumento = this.normalizeTipo(tipoDocumento);

    const rows = await this.prisma.documentoBorrador.findMany({
      where,
      orderBy: { actualizadoEn: 'desc' },
      take: 50,
    });
    return this.enrichRows(rows);
  }

  async countOpen(user: AuthUser | undefined) {
    const usuarioId = this.getUserId(user);
    await this.expireOldDrafts(usuarioId);
    const count = await this.prisma.documentoBorrador.count({
      where: {
        usuarioId,
        estado: OPEN_STATUS,
      },
    });
    return { count };
  }

  async findActive(user: AuthUser | undefined, tipoDocumento: string) {
    const usuarioId = this.getUserId(user);
    const tipo = this.normalizeTipo(tipoDocumento);
    await this.expireOldDrafts(usuarioId);

    return this.prisma.documentoBorrador.findFirst({
      where: {
        usuarioId,
        tipoDocumento: tipo,
        estado: OPEN_STATUS,
      },
      orderBy: { actualizadoEn: 'desc' },
    });
  }

  async findOne(user: AuthUser | undefined, id: number) {
    const usuarioId = this.getUserId(user);
    if (!id) throw new BadRequestException('Borrador no valido');

    const row = await this.prisma.documentoBorrador.findFirst({
      where: { id, usuarioId },
    });
    if (!row) throw new NotFoundException('Borrador no encontrado');
    return (await this.enrichRows([row]))[0];
  }

  async autosave(user: AuthUser | undefined, data: any) {
    const usuarioId = this.getUserId(user);
    const tipoDocumento = this.normalizeTipo(data?.tipoDocumento);
    const draftId = Number(data?.id || 0) || null;
    const payload = {
      tipoDocumento,
      estado: OPEN_STATUS,
      titulo: data?.titulo ? `${data.titulo}`.slice(0, 191) : null,
      data: this.normalizeJson(data?.data),
      totalEstimado: Number(data?.totalEstimado || 0),
      bodegaId: Number(data?.bodegaId || 0) || null,
      clienteId: Number(data?.clienteId || 0) || null,
      usuarioId,
    };

    if (draftId) {
      const existing = await this.prisma.documentoBorrador.findFirst({
        where: { id: draftId, usuarioId },
      });
      if (existing) {
        if (existing.estado !== OPEN_STATUS) return existing;
        return this.prisma.documentoBorrador.update({
          where: { id: existing.id },
          data: payload,
        });
      }
    }

    const active = await this.findActive(user, tipoDocumento);
    if (active) {
      return this.prisma.documentoBorrador.update({
        where: { id: active.id },
        data: payload,
      });
    }

    return this.prisma.documentoBorrador.create({ data: payload });
  }

  async changeStatus(user: AuthUser | undefined, id: number, estado: string, data?: any) {
    const usuarioId = this.getUserId(user);
    if (!id) throw new BadRequestException('Borrador no valido');

    const existing = await this.prisma.documentoBorrador.findFirst({
      where: { id, usuarioId },
    });
    if (!existing) throw new NotFoundException('Borrador no encontrado');

    return this.prisma.documentoBorrador.update({
      where: { id },
      data: {
        estado,
        documentoFinalTipo: data?.documentoFinalTipo ? `${data.documentoFinalTipo}`.slice(0, 191) : undefined,
        documentoFinalId: Number(data?.documentoFinalId || 0) || undefined,
        documentoFinalFolio: data?.documentoFinalFolio ? `${data.documentoFinalFolio}`.slice(0, 191) : undefined,
        bloqueadoPorId: null,
        bloqueadoEn: null,
        bloqueadoHasta: null,
      } as any,
    });
  }

  async lock(user: AuthUser | undefined, id: number) {
    const usuarioId = this.getUserId(user);
    if (!id) throw new BadRequestException('Borrador no valido');
    const existing = await this.prisma.documentoBorrador.findFirst({ where: { id, usuarioId } });
    if (!existing) throw new NotFoundException('Borrador no encontrado');
    if (existing.estado !== OPEN_STATUS) throw new BadRequestException('Este preliminar ya no esta abierto');

    const now = new Date();
    const current = existing as any;
    const lockedByOther =
      current.bloqueadoPorId &&
      Number(current.bloqueadoPorId) !== usuarioId &&
      current.bloqueadoHasta &&
      new Date(current.bloqueadoHasta).getTime() > now.getTime();
    if (lockedByOther) {
      throw new BadRequestException('Este preliminar esta siendo editado por otro usuario');
    }

    return this.prisma.documentoBorrador.update({
      where: { id },
      data: {
        bloqueadoPorId: usuarioId,
        bloqueadoEn: now,
        bloqueadoHasta: this.getLockExpirationDate(),
      } as any,
    });
  }

  async unlock(user: AuthUser | undefined, id: number) {
    const usuarioId = this.getUserId(user);
    if (!id) throw new BadRequestException('Borrador no valido');
    const existing = await this.prisma.documentoBorrador.findFirst({ where: { id, usuarioId } });
    if (!existing) throw new NotFoundException('Borrador no encontrado');
    return this.prisma.documentoBorrador.update({
      where: { id },
      data: { bloqueadoPorId: null, bloqueadoEn: null, bloqueadoHasta: null } as any,
    });
  }

  async discard(user: AuthUser | undefined, id: number) {
    const usuarioId = this.getUserId(user);
    if (!id) throw new BadRequestException('Borrador no valido');

    const existing = await this.prisma.documentoBorrador.findFirst({
      where: { id, usuarioId },
    });
    if (!existing) throw new NotFoundException('Borrador no encontrado');

    await this.prisma.documentoBorrador.delete({ where: { id } });
    return { ok: true };
  }
}
