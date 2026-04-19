import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

const TIPO_PRODUCCION_UNIFICADO = 'PRODUCCION_UNIFICADO';
const GLOBAL_SCOPE = 'GLOBAL';

type ConfigEditable = {
  abreviatura?: string;
  siguienteNumero?: number;
};

@Injectable()
export class CorrelativosService {
  constructor(private prisma: PrismaService) {}

  private sanitizeAbreviatura(value?: string | null) {
    const cleaned = `${value ?? ''}`
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '');

    if (!cleaned) {
      throw new Error('La abreviatura es obligatoria');
    }

    return cleaned.slice(0, 12);
  }

  private sanitizeNumero(value?: number | string | null) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error('El siguiente correlativo debe ser un entero mayor a 0');
    }

    return parsed;
  }

  private defaultBodegaAbreviatura(nombre: string) {
    const words = nombre
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    if (!words.length) return 'BOD';
    if (words.length === 1) return words[0].slice(0, 4);
    return words
      .slice(0, 4)
      .map((word) => word[0])
      .join('');
  }

  private formatDate(date = new Date()) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private formatCorrelativo(abreviatura: string, numero: number) {
    return `${abreviatura}-${`${numero}`.padStart(4, '0')}`;
  }

  private globalDefaults() {
    return {
      tipo: TIPO_PRODUCCION_UNIFICADO,
      scope: GLOBAL_SCOPE,
      nombre: 'Todas las tiendas',
      abreviatura: 'UNI',
      siguienteNumero: 1,
      bodegaId: null as number | null,
    };
  }

  private bodegaScope(bodegaId: number) {
    return `BODEGA:${bodegaId}`;
  }

  private async ensureGlobalConfig(tx: Prisma.TransactionClient) {
    const existing = await tx.correlativoConfig.findUnique({
      where: { scope: GLOBAL_SCOPE },
    });

    if (existing) return existing;

    return tx.correlativoConfig.create({
      data: this.globalDefaults(),
    });
  }

  private async ensureBodegaConfig(tx: Prisma.TransactionClient, bodegaId: number) {
    const bodega = await tx.bodega.findUnique({ where: { id: bodegaId } });
    if (!bodega) {
      throw new NotFoundException('La bodega no existe');
    }

    const scope = this.bodegaScope(bodegaId);
    const existing = await tx.correlativoConfig.findUnique({
      where: { scope },
    });

    if (existing) return existing;

    return tx.correlativoConfig.create({
      data: {
        tipo: TIPO_PRODUCCION_UNIFICADO,
        scope,
        nombre: bodega.nombre,
        abreviatura: this.defaultBodegaAbreviatura(bodega.nombre),
        siguienteNumero: 1,
        bodegaId,
      },
    });
  }

  async listarProduccion() {
    const [bodegas, configs] = await Promise.all([
      this.prisma.bodega.findMany({ orderBy: { nombre: 'asc' } }),
      this.prisma.correlativoConfig.findMany({
        where: { tipo: TIPO_PRODUCCION_UNIFICADO },
        orderBy: [{ bodegaId: 'asc' }, { nombre: 'asc' }],
      }),
    ]);

    const byScope = new Map(configs.map((config) => [config.scope, config]));
    const global = byScope.get(GLOBAL_SCOPE);
    const rows = [
      {
        id: global?.id ?? `virtual-${GLOBAL_SCOPE}`,
        scope: GLOBAL_SCOPE,
        nombre: global?.nombre ?? 'Todas las tiendas',
        abreviatura: global?.abreviatura ?? 'UNI',
        siguienteNumero: global?.siguienteNumero ?? 1,
        bodegaId: null,
        esGlobal: true,
      },
      ...bodegas.map((bodega) => {
        const scope = this.bodegaScope(bodega.id);
        const config = byScope.get(scope);

        return {
          id: config?.id ?? `virtual-${scope}`,
          scope,
          nombre: bodega.nombre,
          abreviatura: config?.abreviatura ?? this.defaultBodegaAbreviatura(bodega.nombre),
          siguienteNumero: config?.siguienteNumero ?? 1,
          bodegaId: bodega.id,
          esGlobal: false,
        };
      }),
    ];

    return rows;
  }

  async actualizarGlobal(data: ConfigEditable) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.ensureGlobalConfig(tx);
      return tx.correlativoConfig.update({
        where: { id: current.id },
        data: {
          abreviatura: this.sanitizeAbreviatura(data.abreviatura ?? current.abreviatura),
          siguienteNumero: this.sanitizeNumero(data.siguienteNumero ?? current.siguienteNumero),
          nombre: current.nombre || 'Todas las tiendas',
        },
      });
    });
  }

  async actualizarBodega(bodegaId: number, data: ConfigEditable) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.ensureBodegaConfig(tx, bodegaId);
      return tx.correlativoConfig.update({
        where: { id: current.id },
        data: {
          abreviatura: this.sanitizeAbreviatura(data.abreviatura ?? current.abreviatura),
          siguienteNumero: this.sanitizeNumero(data.siguienteNumero ?? current.siguienteNumero),
        },
      });
    });
  }

  async generarProduccionCorrelativo(bodegaId?: number | null) {
    return this.prisma.$transaction(async (tx) => {
      const config = bodegaId ? await this.ensureBodegaConfig(tx, Number(bodegaId)) : await this.ensureGlobalConfig(tx);
      const correlativo = this.formatCorrelativo(config.abreviatura, config.siguienteNumero);

      await tx.correlativoConfig.update({
        where: { id: config.id },
        data: { siguienteNumero: config.siguienteNumero + 1 },
      });

      return {
        correlativo,
        scope: config.scope,
        abreviatura: config.abreviatura,
        numero: config.siguienteNumero,
        fecha: this.formatDate(),
        nombre: config.nombre,
      };
    });
  }
}
