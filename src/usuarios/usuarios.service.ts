import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcrypt';
import { unlink } from 'fs/promises';
import { join } from 'path';

@Injectable()
export class UsuariosService {
  constructor(private prisma: PrismaService) {}

  private buildPhotoValue(foto?: { mimetype: string; buffer: Buffer } | null) {
    if (!foto?.buffer?.length || !foto.mimetype) return null;
    return `data:${foto.mimetype};base64,${foto.buffer.toString('base64')}`;
  }

  private buildNombre(data: any = {}) {
    const parts = [
      data.primerNombre,
      data.segundoNombre,
      data.primerApellido,
      data.segundoApellido,
    ]
      .map((value: unknown) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);

    if (parts.length) {
      return parts.join(' ');
    }

    return typeof data.nombre === 'string' ? data.nombre.trim() : '';
  }

  private normalizeOptionalString(value: unknown) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeUsuarioCorrelativo(value: unknown) {
    if (typeof value !== 'string') return null;
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);
    return normalized || null;
  }

  private normalizeOptionalInt(value: unknown) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeOptionalDate(value: unknown) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private buildPayload(data: any = {}, fotoUrl?: string | null) {
    const payload: any = {
      nombre: this.buildNombre(data),
      primerNombre: this.normalizeOptionalString(data.primerNombre),
      segundoNombre: this.normalizeOptionalString(data.segundoNombre),
      primerApellido: this.normalizeOptionalString(data.primerApellido),
      segundoApellido: this.normalizeOptionalString(data.segundoApellido),
      usuario: data.usuario?.trim(),
      usuarioCorrelativo: this.normalizeUsuarioCorrelativo(data.usuarioCorrelativo),
      correo: this.normalizeOptionalString(data.correo),
      telefono: this.normalizeOptionalString(data.telefono),
      dpi: this.normalizeOptionalString(data.dpi),
      direccion: this.normalizeOptionalString(data.direccion),
      fechaNacimiento: this.normalizeOptionalDate(data.fechaNacimiento),
      rolId: Number(data.rolId),
      bodegaId: this.normalizeOptionalInt(data.bodegaId),
    };

    if (typeof fotoUrl !== 'undefined') {
      payload.fotoUrl = fotoUrl;
    }

    return payload;
  }

  private async deleteStoredPhoto(fotoUrl?: string | null) {
    if (!fotoUrl || fotoUrl.startsWith('data:')) return;
    const relativePath = fotoUrl.replace(/^\/+/, '').split('/').join('\\');
    const absolutePath = join(process.cwd(), relativePath);
    try {
      await unlink(absolutePath);
    } catch {
      // Ignore cleanup failures for missing files.
    }
  }

  async createUser(data: any, foto?: { mimetype: string; buffer: Buffer } | null) {
    if (!data || typeof data !== 'object') {
      throw new BadRequestException('No se recibieron datos del usuario');
    }
    if (!data.usuario || !data.rolId || !data.password) {
      throw new BadRequestException('Faltan campos obligatorios del usuario');
    }

    const hashed = await bcrypt.hash(data.password, 10);
    const payload = this.buildPayload(data, this.buildPhotoValue(foto));

    return this.prisma.usuario.create({
      data: {
        ...payload,
        password: hashed,
      },
      include: { rol: true, bodega: true },
    });
  }

  findAll() {
    return this.prisma.usuario.findMany({
      include: { rol: true, bodega: true },
      orderBy: { id: 'desc' },
    });
  }

  findOne(id: number) {
    return this.prisma.usuario.findUnique({
      where: { id },
      include: { rol: true, bodega: true },
    });
  }

  async update(id: number, data: any, foto?: { mimetype: string; buffer: Buffer } | null) {
    if (!data || typeof data !== 'object') {
      throw new BadRequestException('No se recibieron datos del usuario');
    }

    const current = await this.prisma.usuario.findUnique({
      where: { id },
      select: { fotoUrl: true },
    });

    const nextPhotoValue =
      typeof foto === 'undefined' ? undefined : this.buildPhotoValue(foto);
    const payload: any = this.buildPayload(data, nextPhotoValue);

    if (data.password) {
      payload.password = await bcrypt.hash(data.password, 10);
    }

    const updated = await this.prisma.usuario.update({
      where: { id },
      data: payload,
      include: { rol: true, bodega: true },
    });

    if (
      typeof nextPhotoValue !== 'undefined' &&
      current?.fotoUrl &&
      current.fotoUrl !== nextPhotoValue
    ) {
      await this.deleteStoredPhoto(current.fotoUrl);
    }

    return updated;
  }

  async remove(id: number) {
    const user = await this.prisma.usuario.delete({ where: { id } });
    await this.deleteStoredPhoto(user.fotoUrl);
    return user;
  }
}
