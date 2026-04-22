import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma.service';

const TIPO_PRODUCCION_UNIFICADO = 'PRODUCCION_UNIFICADO';
const GLOBAL_SCOPE = 'GLOBAL';

type ConfigEditable = {
  abreviatura?: string;
  siguienteNumero?: number;
};

type CorrelativoConfigRecord = {
  id: number;
  tipo: string;
  scope: string;
  nombre: string;
  abreviatura: string;
  siguienteNumero: number;
  bodegaId: number | null;
  activo: boolean;
  creadoEn: Date;
  actualizadoEn: Date;
};

type BodegaRecord = {
  id: number;
  nombre: string;
  ubicacion?: string | null;
};

type ProduccionUnificadoRecord = {
  id: number;
  scope: string;
  firmaContenido: string;
  correlativo: string;
  abreviatura: string;
  numero: number;
  nombre: string;
  bodegaId: number | null;
  resumen: unknown;
  creadoEn: Date;
  actualizadoEn: Date;
};

type TransactionClient = Pick<
  PrismaService,
  | 'bodega'
  | 'correlativoConfig'
  | 'produccionUnificado'
  | 'produccionUnificadoPedido'
  | 'pedidoProduccion'
>;

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

  private sanitizeFirmaContenido(value?: string | null) {
    const cleaned = `${value ?? ''}`.trim().toLowerCase();
    if (!cleaned) return null;
    return cleaned.slice(0, 191);
  }

  private normalizeText(value: unknown) {
    return `${value ?? ''}`.trim();
  }

  private hashValue(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private normalizePedidoIds(value: unknown) {
    if (!Array.isArray(value)) return [];

    return Array.from(
      new Set(
        value
          .map((pedidoId) => Number(pedidoId))
          .filter((pedidoId) => Number.isInteger(pedidoId) && pedidoId > 0),
      ),
    ).sort((a, b) => a - b);
  }

  private buildResumenFirma(resumen: any) {
    if (!resumen || typeof resumen !== 'object') {
      return null;
    }

    const pedidos = Array.isArray(resumen.pedidos)
      ? resumen.pedidos
          .map((pedido: any) => ({
            id: Number(pedido?.id) || 0,
            folio: this.normalizeText(pedido?.folio),
            solicitadoPor: this.normalizeText(pedido?.solicitadoPor),
            bodegaId: pedido?.bodegaId == null ? null : Number(pedido.bodegaId) || null,
          }))
          .sort((a, b) => {
            const byId = a.id - b.id;
            if (byId !== 0) return byId;
            const byFolio = a.folio.localeCompare(b.folio);
            if (byFolio !== 0) return byFolio;
            const byUsuario = a.solicitadoPor.localeCompare(b.solicitadoPor);
            if (byUsuario !== 0) return byUsuario;
            return (a.bodegaId ?? 0) - (b.bodegaId ?? 0);
          })
      : [];

    const articulos = Array.isArray(resumen.articulos)
      ? resumen.articulos
          .map((articulo: any) => ({
            key: this.normalizeText(articulo?.key),
            codigo: this.normalizeText(articulo?.codigo),
            nombre: this.normalizeText(articulo?.nombre),
            tipo: this.normalizeText(articulo?.tipo),
            genero: this.normalizeText(articulo?.genero),
            tela: this.normalizeText(articulo?.tela),
            talla: this.normalizeText(articulo?.talla),
            color: this.normalizeText(articulo?.color),
            descripcion: this.normalizeText(articulo?.descripcion),
            cantidad: Number(articulo?.cantidad) || 0,
            fuentes: Array.isArray(articulo?.fuentes)
              ? articulo.fuentes
                  .map((fuente: any) => ({
                    pedidoId: Number(fuente?.pedidoId) || 0,
                    folio: this.normalizeText(fuente?.folio),
                    solicitadoPor: this.normalizeText(fuente?.solicitadoPor),
                    cantidad: Number(fuente?.cantidad) || 0,
                  }))
                  .sort((a, b) => {
                    const byPedido = a.pedidoId - b.pedidoId;
                    if (byPedido !== 0) return byPedido;
                    const byFolio = a.folio.localeCompare(b.folio);
                    if (byFolio !== 0) return byFolio;
                    const byUsuario = a.solicitadoPor.localeCompare(b.solicitadoPor);
                    if (byUsuario !== 0) return byUsuario;
                    return a.cantidad - b.cantidad;
                  })
              : [],
          }))
          .sort((a, b) => {
            const byKey = a.key.localeCompare(b.key);
            if (byKey !== 0) return byKey;
            const byCodigo = a.codigo.localeCompare(b.codigo);
            if (byCodigo !== 0) return byCodigo;
            return a.nombre.localeCompare(b.nombre);
          })
      : [];

    return this.hashValue(
      JSON.stringify({
        pedidos,
        articulos,
      }),
    );
  }

  private resolveFirmaContenido(input?: { firmaContenido?: string | null; resumen?: unknown }) {
    const byResumen = this.buildResumenFirma(input?.resumen);
    if (byResumen) return byResumen;
    return this.sanitizeFirmaContenido(input?.firmaContenido);
  }

  private async buildPedidoSnapshot(tx: TransactionClient, pedidoIds: number[]) {
    const normalizedPedidoIds = this.normalizePedidoIds(pedidoIds);
    if (!normalizedPedidoIds.length) return null;

    const pedidos = await tx.pedidoProduccion.findMany({
      where: { id: { in: normalizedPedidoIds } },
      select: {
        id: true,
        estado: true,
        solicitadoPor: true,
        bodegaId: true,
        detalle: {
          select: {
            productoId: true,
            cantidad: true,
            descripcion: true,
            precioUnit: true,
            descuento: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    const activos = pedidos
      .filter((pedido) => this.normalizeText(pedido.estado).toLowerCase() !== 'anulado')
      .map((pedido) => ({
        id: pedido.id,
        estado: this.normalizeText(pedido.estado),
        solicitadoPor: this.normalizeText(pedido.solicitadoPor),
        bodegaId: pedido.bodegaId ?? null,
        detalle: [...pedido.detalle]
          .map((detalle) => ({
            productoId: Number(detalle.productoId) || 0,
            cantidad: Number(detalle.cantidad) || 0,
            descripcion: this.normalizeText(detalle.descripcion),
            precioUnit: Number(detalle.precioUnit) || 0,
            descuento: Number(detalle.descuento) || 0,
          }))
          .sort((a, b) => {
            const byProducto = a.productoId - b.productoId;
            if (byProducto !== 0) return byProducto;
            const byDescripcion = a.descripcion.localeCompare(b.descripcion);
            if (byDescripcion !== 0) return byDescripcion;
            const byCantidad = a.cantidad - b.cantidad;
            if (byCantidad !== 0) return byCantidad;
            const byPrecio = a.precioUnit - b.precioUnit;
            if (byPrecio !== 0) return byPrecio;
            return a.descuento - b.descuento;
          }),
      }));

    if (!activos.length) {
      return null;
    }

    return {
      pedidoIds: activos.map((pedido) => pedido.id),
      firmaContenido: this.hashValue(JSON.stringify(activos)),
      snapshot: activos,
    };
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

  private async ensureGlobalConfig(tx: TransactionClient): Promise<CorrelativoConfigRecord> {
    const existing = (await tx.correlativoConfig.findUnique({
      where: { scope: GLOBAL_SCOPE },
    })) as CorrelativoConfigRecord | null;

    if (existing) return existing;

    return tx.correlativoConfig.create({
      data: this.globalDefaults(),
    }) as Promise<CorrelativoConfigRecord>;
  }

  private async ensureBodegaConfig(
    tx: TransactionClient,
    bodegaId: number,
  ): Promise<CorrelativoConfigRecord> {
    const bodega = (await tx.bodega.findUnique({
      where: { id: bodegaId },
    })) as BodegaRecord | null;
    if (!bodega) {
      throw new NotFoundException('La bodega no existe');
    }

    const scope = this.bodegaScope(bodegaId);
    const existing = (await tx.correlativoConfig.findUnique({
      where: { scope },
    })) as CorrelativoConfigRecord | null;

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
    }) as Promise<CorrelativoConfigRecord>;
  }

  async listarProduccion() {
    const [bodegas, configs] = (await Promise.all([
      this.prisma.bodega.findMany({ orderBy: { nombre: 'asc' } }),
      this.prisma.correlativoConfig.findMany({
        where: { tipo: TIPO_PRODUCCION_UNIFICADO },
        orderBy: [{ bodegaId: 'asc' }, { nombre: 'asc' }],
      }),
    ])) as [BodegaRecord[], CorrelativoConfigRecord[]];

    const byScope = new Map<string, CorrelativoConfigRecord>(
      configs.map((config) => [config.scope, config]),
    );
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

  async generarProduccionCorrelativo(input?: {
    bodegaId?: number | null;
    pedidoIds?: number[];
    firmaContenido?: string | null;
    resumen?: unknown;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const bodegaId = input?.bodegaId ?? null;
      const config = bodegaId ? await this.ensureBodegaConfig(tx, Number(bodegaId)) : await this.ensureGlobalConfig(tx);
      const pedidoSnapshot = await this.buildPedidoSnapshot(tx, input?.pedidoIds || []);
      const firmaContenido = pedidoSnapshot?.firmaContenido || this.resolveFirmaContenido(input);

      if (!firmaContenido) {
        throw new Error('No hay pedidos disponibles para unificar');
      }

      const existente = (await tx.produccionUnificado.findUnique({
        where: {
          scope_firmaContenido: {
            scope: config.scope,
            firmaContenido,
          },
        },
      })) as ProduccionUnificadoRecord | null;

      if (existente) {
        if (pedidoSnapshot?.pedidoIds.length) {
          await tx.produccionUnificadoPedido.createMany({
            data: pedidoSnapshot.pedidoIds.map((pedidoId) => ({
              produccionUnificadoId: existente.id,
              pedidoId,
            })),
            skipDuplicates: true,
          });
        }

        return {
          unificacionId: existente.id,
          correlativo: existente.correlativo,
          scope: existente.scope,
          abreviatura: existente.abreviatura,
          numero: existente.numero,
          fecha: this.formatDate(existente.creadoEn),
          nombre: existente.nombre,
          reutilizado: true,
        };
      }

      const correlativo = this.formatCorrelativo(config.abreviatura, config.siguienteNumero);
      const creado = await tx.produccionUnificado.create({
        data: {
          scope: config.scope,
          firmaContenido,
          correlativo,
          abreviatura: config.abreviatura,
          numero: config.siguienteNumero,
          nombre: config.nombre,
          bodegaId: config.bodegaId,
          resumen: (input?.resumen ?? pedidoSnapshot?.snapshot ?? null) as any,
        },
      });

      if (pedidoSnapshot?.pedidoIds.length) {
        await tx.produccionUnificadoPedido.createMany({
          data: pedidoSnapshot.pedidoIds.map((pedidoId) => ({
            produccionUnificadoId: creado.id,
            pedidoId,
          })),
          skipDuplicates: true,
        });
      }

      await tx.correlativoConfig.update({
        where: { id: config.id },
        data: { siguienteNumero: config.siguienteNumero + 1 },
      });

      return {
        unificacionId: creado.id,
        correlativo,
        scope: config.scope,
        abreviatura: config.abreviatura,
        numero: config.siguienteNumero,
        fecha: this.formatDate(),
        nombre: config.nombre,
        reutilizado: false,
      };
    });
  }
}
