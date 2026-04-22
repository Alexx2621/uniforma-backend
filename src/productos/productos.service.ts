import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma.service';
import {
  DEFAULT_PRODUCTOS_MASS_CONFIG,
  ProductosMassConfig,
} from './productos-mass-config';

type CatalogoItem = {
  id: number;
  nombre: string;
};

@Injectable()
export class ProductosService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.producto.findMany({
      include: {
        categoria: true,
        tela: true,
        color: true,
        talla: true,
      },
    });
  }

  findOne(id: number) {
    return this.prisma.producto.findUnique({
      where: { id },
      include: {
        categoria: true,
        tela: true,
        color: true,
        talla: true,
      },
    });
  }

  create(data: any) {
    // Si el payload trae id (null o numero) lo removemos para no romper el autoincrement
    // de la base de datos.
    const { id: _omit, ...payload } = data ?? {};

    return this.prisma.producto.create({ data: payload }).catch((error) => {
      this.handlePrismaError(error);
    });
  }

  update(id: number, data: any) {
    return this.prisma.producto
      .update({
        where: { id },
        data,
      })
      .catch((error) => {
        this.handlePrismaError(error);
      });
  }

  delete(id: number) {
    return this.prisma.producto.delete({
      where: { id },
    });
  }
  async buscarPorCodigo(codigo: string) {
    return this.prisma.producto.findFirst({
      where: { codigo },
      include: { categoria: true },
    });
  }

  async previewCargaMasivaBase(configOverride?: unknown) {
    return this.procesarCargaMasivaBase(false, configOverride);
  }

  async cargaMasivaBase(configOverride?: unknown) {
    return this.procesarCargaMasivaBase(true, configOverride);
  }

  private async procesarCargaMasivaBase(
    persistir: boolean,
    configOverride?: unknown,
  ) {
    const massConfig = await this.resolveMassConfig(configOverride);
    const [categorias, telas, tallas, colores] = (await Promise.all([
      this.prisma.categoria.findMany(),
      this.prisma.tela.findMany(),
      this.prisma.talla.findMany(),
      this.prisma.color.findMany(),
    ])) as [CatalogoItem[], CatalogoItem[], CatalogoItem[], CatalogoItem[]];

    const categoriaMap = new Map(
      categorias.map((item) => [this.normalizarTexto(item.nombre), item]),
    );
    const telaMap = new Map(
      telas.map((item) => [this.normalizarTexto(item.nombre), item]),
    );
    const colorMap = new Map(
      colores.map((item) => [this.normalizarTexto(item.nombre), item]),
    );
    const generoMap = new Map(
      massConfig.generos.map((item) => [this.normalizarTexto(item.nombre), item]),
    );
    const telaConfigMap = new Map(
      massConfig.telas.map((item) => [this.normalizarTexto(item.nombre), item]),
    );

    const faltantes = [
      ...massConfig.tipos
        .map((item) => item.categoria || item.nombre)
        .filter((nombre) => !categoriaMap.has(this.normalizarTexto(nombre))),
      ...massConfig.telas.map((item) => item.nombre).filter(
        (nombre) => !telaMap.has(this.normalizarTexto(nombre)),
      ),
      ...massConfig.tipos.flatMap((item) =>
        item.generos.filter(
          (genero) => !generoMap.has(this.normalizarTexto(genero)),
        ),
      ),
      ...massConfig.tipos.flatMap((item) =>
        (item.colores || []).filter(
          (color) => !colorMap.has(this.normalizarTexto(color)),
        ),
      ),
    ];

    if (faltantes.length) {
      throw new ConflictException(
        `Faltan catalogos requeridos: ${Array.from(new Set(faltantes)).join(', ')}`,
      );
    }

    const colorAbreviaciones = this.construirAbreviacionesColor(
      colores,
      massConfig.colorAbreviaciones || {},
    );

    let creados = 0;
    let actualizados = 0;
    let combinacionesEsperadas = 0;
    const detalleTipos: Array<{
      tipo: string;
      total: number;
      creados: number;
      actualizados: number;
      muestras: string[];
    }> = [];

    for (const tipo of massConfig.tipos) {
      const categoria = categoriaMap.get(
        this.normalizarTexto(tipo.categoria || tipo.nombre),
      );
      const generos = tipo.generos
        .map((genero) => generoMap.get(this.normalizarTexto(genero)))
        .filter(
          (
            item,
          ): item is (typeof massConfig.generos)[number] => item !== undefined,
        );
      const telasPermitidas = tipo.telas
        .map((tela) => telaMap.get(this.normalizarTexto(tela)))
        .filter((item): item is CatalogoItem => item !== undefined);
      const coloresConfigurados = tipo.colores ?? [];
      const coloresPermitidos = coloresConfigurados.length
        ? coloresConfigurados
            .map((color) => colorMap.get(this.normalizarTexto(color)))
            .filter((item): item is CatalogoItem => item !== undefined)
        : colores;

      combinacionesEsperadas +=
        generos.length * telasPermitidas.length * tallas.length * coloresPermitidos.length;
      const resumenTipo = {
        tipo: tipo.nombre,
        total: 0,
        creados: 0,
        actualizados: 0,
        muestras: [] as string[],
      };

      for (const genero of generos) {
        for (const tela of telasPermitidas) {
          const telaAbreviacion =
            telaConfigMap.get(this.normalizarTexto(tela.nombre))?.abreviacion || '';
          if (!telaAbreviacion) continue;

          for (const talla of tallas) {
            const tallaNombre = this.normalizarTexto(talla.nombre);

            for (const color of coloresPermitidos) {
              const colorAbreviacion = colorAbreviaciones.get(color.id);
              const codigo = `${tipo.abreviacion}${genero.abreviacion}${telaAbreviacion}${tallaNombre}${colorAbreviacion}`;
              resumenTipo.total += 1;
              if (resumenTipo.muestras.length < 6) {
                resumenTipo.muestras.push(codigo);
              }

              const payload = {
                codigo,
                nombre: tipo.nombre,
                genero: genero.nombre,
                tipo: tipo.nombre,
                precio: massConfig.precio,
                mermaPorcentaje: massConfig.mermaPorcentaje,
                stockMax: massConfig.stockMax,
                categoriaId: categoria?.id,
                telaId: tela.id,
                tallaId: talla.id,
                colorId: color.id,
              };

              const existente = await this.prisma.producto.findUnique({
                where: { codigo },
                select: { id: true },
              });

              if (existente) {
                if (persistir) {
                  await this.prisma.producto.update({
                    where: { codigo },
                    data: payload,
                  });
                }
                actualizados += 1;
                resumenTipo.actualizados += 1;
              } else {
                if (persistir) {
                  await this.prisma.producto.create({ data: payload });
                }
                creados += 1;
                resumenTipo.creados += 1;
              }
            }
          }
        }
      }

      detalleTipos.push(resumenTipo);
    }

    const total = await this.prisma.producto.count();

    return {
      creados,
      actualizados,
      total,
      configuracion: {
        tipos: massConfig.tipos.length,
        generos: massConfig.generos.length,
        telas: massConfig.telas.length,
        tallas: tallas.length,
        colores: colores.length,
        combinacionesEsperadas,
      },
      detalleTipos,
      persistido: persistir,
    };
  }

  /**
   * Traducimos errores conocidos de Prisma a respuestas HTTP entendibles
   * para el frontend.
   */
  private handlePrismaError(error: unknown): never {
    if (error instanceof PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('El codigo de producto ya existe');
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('Producto no encontrado');
      }
      if (error.code === 'P2011') {
        throw new ConflictException('Datos requeridos faltantes o nulos');
      }
    }

    throw error;
  }

  private normalizarTexto(valor?: string | null) {
    return `${valor || ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
  }

  private abreviarColor(nombre?: string | null) {
    const limpio = this.normalizarTexto(nombre);
    const partes = limpio.split(/\s+/).filter(Boolean);
    if (!partes.length) return '';
    if (partes.length >= 2) {
      return `${partes[0][0] || ''}${partes[1][0] || ''}`;
    }
    return limpio.slice(0, 2);
  }

  private construirAbreviacionesColor(
    colores: Array<{ id: number; nombre: string }>,
    overrides: Record<string, string> = {},
  ) {
    const grupos = new Map<string, Array<{ id: number; nombre: string }>>();

    for (const color of colores) {
      const override = overrides[this.normalizarTexto(color.nombre)];
      if (override) {
        grupos.set(`override:${color.id}`, [{ ...color, nombre: override }]);
        continue;
      }
      const base = this.abreviarColor(color.nombre);
      const current = grupos.get(base) || [];
      current.push(color);
      grupos.set(base, current);
    }

    const resultado = new Map<number, string>();
    const usados = new Set<string>();

    for (const [base, items] of grupos.entries()) {
      if (base.startsWith('override:')) {
        resultado.set(items[0].id, items[0].nombre);
        usados.add(items[0].nombre);
        continue;
      }
      if (items.length === 1) {
        resultado.set(items[0].id, base);
        usados.add(base);
        continue;
      }

      items.forEach((color, index) => {
        if (index === 0) {
          resultado.set(color.id, base);
          usados.add(base);
          return;
        }

        const limpio = this.normalizarTexto(color.nombre);
        const partes = limpio.split(/\s+/).filter(Boolean);
        let candidato = base;

        if (partes.length >= 2) {
          candidato = `${partes[0][0] || ''}${partes[1].slice(0, 2)}`;
        } else {
          candidato = limpio.slice(0, Math.min(3 + index, limpio.length));
        }

        let sufijo = 2;
        while (usados.has(candidato)) {
          candidato = `${base}${sufijo}`;
          sufijo += 1;
        }

        resultado.set(color.id, candidato);
        usados.add(candidato);
      });
    }

    return resultado;
  }

  private async resolveMassConfig(
    override?: unknown,
  ): Promise<ProductosMassConfig> {
    if (override && typeof override === 'object') {
      return this.normalizeMassConfig(override);
    }

    const config = await this.prisma.notificacionConfig.findUnique({
      where: { id: 1 },
      select: { productMassConfig: true },
    });

    return this.normalizeMassConfig(config?.productMassConfig);
  }

  private normalizeMassConfig(raw: unknown): ProductosMassConfig {
    if (!raw || typeof raw !== 'object') {
      return DEFAULT_PRODUCTOS_MASS_CONFIG;
    }

    const parsed = raw as Partial<ProductosMassConfig>;
    return {
      precio:
        typeof parsed.precio === 'number' && Number.isFinite(parsed.precio)
          ? parsed.precio
          : DEFAULT_PRODUCTOS_MASS_CONFIG.precio,
      stockMax:
        typeof parsed.stockMax === 'number' && Number.isFinite(parsed.stockMax)
          ? parsed.stockMax
          : DEFAULT_PRODUCTOS_MASS_CONFIG.stockMax,
      mermaPorcentaje:
        typeof parsed.mermaPorcentaje === 'number' &&
        Number.isFinite(parsed.mermaPorcentaje)
          ? parsed.mermaPorcentaje
          : DEFAULT_PRODUCTOS_MASS_CONFIG.mermaPorcentaje,
      generos:
        Array.isArray(parsed.generos) && parsed.generos.length
          ? parsed.generos
              .filter(
                (
                  item,
                ): item is { nombre: string; abreviacion: string } =>
                  typeof item?.nombre === 'string' &&
                  typeof item?.abreviacion === 'string',
              )
              .map((item) => ({
                nombre: item.nombre.trim(),
                abreviacion: item.abreviacion.trim(),
              }))
          : DEFAULT_PRODUCTOS_MASS_CONFIG.generos,
      telas:
        Array.isArray(parsed.telas) && parsed.telas.length
          ? parsed.telas
              .filter(
                (
                  item,
                ): item is { nombre: string; abreviacion: string } =>
                  typeof item?.nombre === 'string' &&
                  typeof item?.abreviacion === 'string',
              )
              .map((item) => ({
                nombre: item.nombre.trim(),
                abreviacion: item.abreviacion.trim(),
              }))
          : DEFAULT_PRODUCTOS_MASS_CONFIG.telas,
      colorAbreviaciones:
        parsed.colorAbreviaciones &&
        typeof parsed.colorAbreviaciones === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.colorAbreviaciones).filter(
                ([key, value]) =>
                  typeof key === 'string' && typeof value === 'string',
              ),
            )
          : DEFAULT_PRODUCTOS_MASS_CONFIG.colorAbreviaciones,
      tipos:
        Array.isArray(parsed.tipos) && parsed.tipos.length
          ? parsed.tipos
              .filter(
                (
                  item,
                ): item is {
                  nombre: string;
                  abreviacion: string;
                  categoria?: string;
                  generos: string[];
                  telas: string[];
                  colores?: string[];
                } =>
                  typeof item?.nombre === 'string' &&
                  typeof item?.abreviacion === 'string' &&
                  Array.isArray(item?.generos) &&
                  Array.isArray(item?.telas),
              )
              .map((item) => ({
                nombre: item.nombre.trim(),
                abreviacion: item.abreviacion.trim(),
                categoria:
                  typeof item.categoria === 'string'
                    ? item.categoria.trim()
                    : item.nombre.trim(),
                generos: item.generos
                  .filter((value) => typeof value === 'string')
                  .map((value) => value.trim()),
                telas: item.telas
                  .filter((value) => typeof value === 'string')
                  .map((value) => value.trim()),
                colores: Array.isArray(item.colores)
                  ? item.colores
                      .filter((value) => typeof value === 'string')
                      .map((value) => value.trim())
                  : undefined,
              }))
          : DEFAULT_PRODUCTOS_MASS_CONFIG.tipos,
    };
  }
}
