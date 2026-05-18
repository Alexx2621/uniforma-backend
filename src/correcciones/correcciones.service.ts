import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type AuthUser = { id?: number; rol?: string };

const TIPOS_CORREGIBLES = new Set(['reporteDiario', 'reporteQuincenal']);

@Injectable()
export class CorreccionesService {
  constructor(private prisma: PrismaService) {}

  private ensureUser(user?: AuthUser) {
    const usuarioId = Number(user?.id || 0);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      throw new BadRequestException('No se pudo identificar el usuario');
    }
    return usuarioId;
  }

  private assertManage(user?: AuthUser) {
    if (`${user?.rol || ''}`.trim().toUpperCase() !== 'ADMIN') {
      throw new ForbiddenException('Solo ADMIN puede aplicar correcciones controladas');
    }
  }

  private getByPath(data: any, path: string) {
    return path.split('.').reduce((current, part) => (current == null ? undefined : current[part]), data);
  }

  private setByPath(data: any, path: string, value: unknown) {
    const next = JSON.parse(JSON.stringify(data || {}));
    const parts = path.split('.');
    let cursor = next;
    for (const part of parts.slice(0, -1)) {
      if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
        cursor[part] = {};
      }
      cursor = cursor[part];
    }
    cursor[parts[parts.length - 1]] = value;
    return next;
  }

  private normalizeCampo(documento: any, campo?: string) {
    const value = `${campo || ''}`.trim();
    const data = documento?.data as any;

    if (documento.tipo === 'reporteQuincenal') {
      const day = Number(value.replace(/^ventasPorDia\./, ''));
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        throw new BadRequestException('Selecciona un dia valido para corregir');
      }
      return {
        campo: `ventasPorDia.${day}`,
        etiqueta: `Venta diaria dia ${day}`,
      };
    }

    if (documento.tipo === 'reporteDiario') {
      if (value === 'metaMes' || value === 'promedioDiario') {
        return { campo: value, etiqueta: value === 'metaMes' ? 'Meta mes' : 'Promedio diario' };
      }
      const allowedTopLevel = ['fecha', 'tienda', 'vendedor'];
      if (allowedTopLevel.includes(value) && Object.prototype.hasOwnProperty.call(data || {}, value)) {
        return { campo: value, etiqueta: value };
      }
    }

    throw new BadRequestException('Ese campo no esta habilitado para correccion controlada');
  }

  private normalizeValue(value: unknown) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return '';
      const numeric = Number(trimmed.replace(/,/g, ''));
      return Number.isFinite(numeric) ? numeric : trimmed;
    }
    return value;
  }

  buscarDocumentos(filters: { tipo?: string; q?: string; limit?: number }) {
    const tipo = `${filters.tipo || ''}`.trim();
    const q = `${filters.q || ''}`.trim();
    const limit = Math.min(Math.max(Number(filters.limit || 25), 1), 100);
    const where: any = {};

    if (tipo) {
      if (!TIPOS_CORREGIBLES.has(tipo)) throw new BadRequestException('Tipo de documento no soportado');
      where.tipo = tipo;
    } else {
      where.tipo = { in: Array.from(TIPOS_CORREGIBLES) };
    }

    if (q) {
      where.OR = [
        { correlativo: { contains: q } },
        { titulo: { contains: q } },
      ];
    }

    return this.prisma.documentoGenerado.findMany({
      where,
      include: {
        usuario: { select: { id: true, nombre: true, usuario: true } },
        _count: { select: { correcciones: true } },
      },
      orderBy: { actualizadoEn: 'desc' },
      take: limit,
    });
  }

  async obtenerDocumento(id: number) {
    const documento = await this.prisma.documentoGenerado.findUnique({
      where: { id },
      include: {
        usuario: { select: { id: true, nombre: true, usuario: true } },
        correcciones: {
          include: { usuario: { select: { id: true, nombre: true, usuario: true } } },
          orderBy: { creadoEn: 'desc' },
          take: 25,
        },
      },
    });

    if (!documento || !TIPOS_CORREGIBLES.has(documento.tipo)) {
      throw new NotFoundException('Documento no encontrado');
    }

    return documento;
  }

  async corregirDocumento(
    id: number,
    body: { campo?: string; valorNuevo?: unknown; motivo?: string },
    user?: AuthUser,
  ) {
    const usuarioId = this.ensureUser(user);
    this.assertManage(user);

    const motivo = `${body?.motivo || ''}`.trim();
    if (motivo.length < 8) {
      throw new BadRequestException('Ingresa un motivo de al menos 8 caracteres');
    }

    const documento = await this.prisma.documentoGenerado.findUnique({ where: { id } });
    if (!documento || !TIPOS_CORREGIBLES.has(documento.tipo)) {
      throw new NotFoundException('Documento no encontrado');
    }

    const { campo, etiqueta } = this.normalizeCampo(documento, body?.campo);
    const dataAnterior = JSON.parse(JSON.stringify(documento.data || {}));
    const valorAnterior = this.getByPath(dataAnterior, campo);
    const valorNuevo = this.normalizeValue(body?.valorNuevo);
    const dataNueva = this.setByPath(dataAnterior, campo, valorNuevo);

    const [actualizado, correccion] = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.documentoGenerado.update({
        where: { id },
        data: { data: dataNueva as object },
        include: { usuario: { select: { id: true, nombre: true, usuario: true } } },
      });

      const audit = await tx.correccionDocumento.create({
        data: {
          documentoId: id,
          usuarioId,
          tipoDocumento: documento.tipo,
          correlativo: documento.correlativo,
          campo,
          etiqueta,
          valorAnterior: valorAnterior === undefined ? Prisma.JsonNull : (valorAnterior as any),
          valorNuevo: valorNuevo as any,
          motivo,
          dataAnterior: dataAnterior as object,
          dataNueva: dataNueva as object,
        },
        include: { usuario: { select: { id: true, nombre: true, usuario: true } } },
      });

      return [updated, audit] as const;
    });

    return { documento: actualizado, correccion };
  }

  historial(documentoId?: number) {
    return this.prisma.correccionDocumento.findMany({
      where: documentoId ? { documentoId } : {},
      include: {
        usuario: { select: { id: true, nombre: true, usuario: true } },
        documento: { select: { id: true, tipo: true, correlativo: true, titulo: true } },
      },
      orderBy: { creadoEn: 'desc' },
      take: 100,
    });
  }
}
