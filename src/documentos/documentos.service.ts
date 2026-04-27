import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CorrelativosService } from '../correlativos/correlativos.service';

const DOCUMENTO_OPERACION: Record<string, string> = {
  cotizacion: 'cotizacion',
  reporteDiario: 'reporteDiario',
  reporteQuincenal: 'reporteQuincenal',
};

@Injectable()
export class DocumentosService {
  constructor(
    private prisma: PrismaService,
    private correlativos: CorrelativosService,
  ) {}

  private normalizeTipo(tipo?: string) {
    const value = `${tipo || ''}`.trim();
    if (!DOCUMENTO_OPERACION[value]) {
      throw new BadRequestException('Tipo de documento no soportado');
    }
    return value;
  }

  private ensureUsuario(usuarioId: number) {
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      throw new BadRequestException('No se pudo identificar el usuario');
    }
  }

  listar(tipo?: string, usuarioId?: number) {
    const where: any = {};
    if (tipo) {
      where.tipo = this.normalizeTipo(tipo);
    }
    if (usuarioId !== undefined) {
      if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
        throw new BadRequestException('Usuario no valido');
      }
      where.usuarioId = usuarioId;
    }
    return this.prisma.documentoGenerado.findMany({
      where,
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            usuario: true,
            usuarioCorrelativo: true,
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async obtener(id: number) {
    const documento = await this.prisma.documentoGenerado.findUnique({
      where: { id },
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            usuario: true,
            usuarioCorrelativo: true,
          },
        },
      },
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    return documento;
  }

  async crear(usuarioId: number, body: { tipo?: string; titulo?: string; data?: unknown }) {
    this.ensureUsuario(usuarioId);
    const tipo = this.normalizeTipo(body.tipo);
    const correlativoResp = await this.correlativos.generarUsuarioOperacionCorrelativo(
      usuarioId,
      DOCUMENTO_OPERACION[tipo],
    );

    return this.prisma.documentoGenerado.create({
      data: {
        tipo,
        correlativo: correlativoResp.correlativo,
        titulo: `${body.titulo || ''}`.trim() || null,
        data: (body.data ?? {}) as object,
        usuarioId,
      },
    });
  }

  async actualizar(id: number, body: { titulo?: string; data?: unknown }) {
    await this.obtener(id);
    return this.prisma.documentoGenerado.update({
      where: { id },
      data: {
        titulo: body.titulo !== undefined ? `${body.titulo || ''}`.trim() || null : undefined,
        data: body.data !== undefined ? (body.data ?? {}) as object : undefined,
      },
    });
  }

  async eliminar(id: number) {
    await this.obtener(id);
    return this.prisma.documentoGenerado.delete({ where: { id } });
  }
}
