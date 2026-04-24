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

type ActualizacionMasivaPayload = {
  filtros?: {
    tipos?: unknown;
    generos?: unknown;
    telas?: unknown;
    tallas?: unknown;
    colores?: unknown;
  };
  cambios?: {
    precio?: unknown;
    stockMax?: unknown;
    mermaPorcentaje?: unknown;
  };
};

type CreacionMasivaPayload = {
  filtros?: {
    tipos?: unknown;
    generos?: unknown;
    telas?: unknown;
    tallas?: unknown;
    colores?: unknown;
    categoria?: unknown;
    tipoAbreviacion?: unknown;
  };
  valores?: {
    precio?: unknown;
    stockMax?: unknown;
    mermaPorcentaje?: unknown;
  };
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

  async previewActualizacionMasiva(payload: ActualizacionMasivaPayload) {
    return this.procesarActualizacionMasiva(false, payload);
  }

  async actualizacionMasiva(payload: ActualizacionMasivaPayload) {
    return this.procesarActualizacionMasiva(true, payload);
  }

  async previewCreacionMasiva(payload: CreacionMasivaPayload) {
    return this.procesarCreacionMasiva(false, payload);
  }

  async creacionMasiva(payload: CreacionMasivaPayload) {
    return this.procesarCreacionMasiva(true, payload);
  }

  private async procesarActualizacionMasiva(
    persistir: boolean,
    payload: ActualizacionMasivaPayload,
  ) {
    const filtros = this.normalizeActualizacionFiltros(payload?.filtros || {});
    const cambios = this.normalizeActualizacionCambios(payload?.cambios || {});

    if (!Object.keys(cambios).length) {
      throw new ConflictException('Define al menos un cambio para aplicar');
    }

    const productosBase = await this.prisma.producto.findMany({
      include: {
        categoria: true,
        tela: true,
        talla: true,
        color: true,
      },
      orderBy: { codigo: 'asc' },
    });
    const productos = productosBase.filter((producto) =>
      this.coincideFiltro(producto.tipo, filtros.tipos) &&
      this.coincideFiltro(producto.genero, filtros.generos) &&
      this.coincideFiltro(producto.tela?.nombre, filtros.telas) &&
      this.coincideFiltro(producto.talla?.nombre, filtros.tallas) &&
      this.coincideFiltro(producto.color?.nombre, filtros.colores),
    );

    const muestras = productos.slice(0, 12).map((producto) => ({
      id: producto.id,
      codigo: producto.codigo,
      tipo: producto.tipo,
      genero: producto.genero,
      tela: producto.tela?.nombre || null,
      talla: producto.talla?.nombre || null,
      color: producto.color?.nombre || null,
      precioActual: Number(producto.precio || 0),
      precioNuevo: cambios.precio ?? Number(producto.precio || 0),
      stockMaxActual: Number(producto.stockMax || 0),
      stockMaxNuevo: cambios.stockMax ?? Number(producto.stockMax || 0),
      mermaPorcentajeActual: Number(producto.mermaPorcentaje || 0),
      mermaPorcentajeNuevo:
        cambios.mermaPorcentaje ?? Number(producto.mermaPorcentaje || 0),
    }));

    if (persistir && productos.length) {
      await this.prisma.producto.updateMany({
        where: { id: { in: productos.map((producto) => producto.id) } },
        data: cambios,
      });
    }

    return {
      persistido: persistir,
      totalCoincidencias: productos.length,
      actualizados: persistir ? productos.length : 0,
      cambios,
      filtros,
      muestras,
    };
  }

  private async procesarCreacionMasiva(
    persistir: boolean,
    payload: CreacionMasivaPayload,
  ) {
    const filtros = {
      tipos: this.parseFiltroLista(payload?.filtros?.tipos),
      generos: this.parseFiltroLista(payload?.filtros?.generos),
      telas: this.parseFiltroLista(payload?.filtros?.telas),
      tallas: this.parseFiltroLista(payload?.filtros?.tallas),
      colores: this.parseFiltroLista(payload?.filtros?.colores),
      categoria: `${payload?.filtros?.categoria || ''}`.trim(),
      tipoAbreviacion: `${payload?.filtros?.tipoAbreviacion || ''}`.trim().toUpperCase(),
    };
    const valores = this.normalizeCreacionMasivaValores(payload?.valores || {});

    if (!filtros.tipos.length) {
      throw new ConflictException('Define al menos un tipo de producto');
    }
    if (!filtros.generos.length) {
      throw new ConflictException('Define al menos un genero');
    }
    if (!filtros.telas.length) {
      throw new ConflictException('Define al menos una tela');
    }

    const massConfig = await this.resolveMassConfig();
    const [categorias, telas, tallas, colores] = (await Promise.all([
      this.prisma.categoria.findMany(),
      this.prisma.tela.findMany(),
      this.prisma.talla.findMany(),
      this.prisma.color.findMany(),
    ])) as [CatalogoItem[], CatalogoItem[], CatalogoItem[], CatalogoItem[]];

    const generosConfigMap = new Map(
      massConfig.generos.map((item) => [this.normalizarTexto(item.nombre), item]),
    );
    const telasConfigMap = new Map(
      massConfig.telas.map((item) => [this.normalizarTexto(item.nombre), item]),
    );
    const tiposConfigMap = new Map(
      massConfig.tipos.map((item) => [this.normalizarTexto(item.nombre), item]),
    );
    const categoriaMap = new Map(
      categorias.map((item) => [this.normalizarTexto(item.nombre), item]),
    );
    const telaMap = new Map(
      telas.map((item) => [this.normalizarTexto(item.nombre), item]),
    );
    const tallaMap = new Map(
      tallas.map((item) => [this.normalizarTexto(item.nombre), item]),
    );
    const colorMap = new Map(
      colores.map((item) => [this.normalizarTexto(item.nombre), item]),
    );
    const telasSeleccionadas = filtros.telas.map((nombre) => telaMap.get(this.normalizarTexto(nombre)));
    const tallasSeleccionadas = filtros.tallas.length
      ? filtros.tallas.map((nombre) => tallaMap.get(this.normalizarTexto(nombre)))
      : tallas;
    const coloresSeleccionados = filtros.colores.length
      ? filtros.colores.map((nombre) => colorMap.get(this.normalizarTexto(nombre)))
      : colores;

    const faltantes = [
      ...telasSeleccionadas.map((item, index) => (item ? '' : filtros.telas[index])),
      ...tallasSeleccionadas.map((item, index) => (item ? '' : filtros.tallas[index])),
      ...coloresSeleccionados.map((item, index) => (item ? '' : filtros.colores[index])),
    ].filter(Boolean);

    if (faltantes.length) {
      throw new ConflictException(`Faltan catalogos requeridos: ${Array.from(new Set(faltantes)).join(', ')}`);
    }

    const codigosExistentes = new Set(
      (
        await this.prisma.producto.findMany({
          select: { codigo: true },
        })
      ).map((producto) => this.normalizarTexto(producto.codigo)),
    );
    const codigosPlaneados = new Set<string>();

    const resultados: Array<{
      codigo: string;
      tipo: string;
      genero: string;
      tela: string;
      talla: string;
      color: string;
      precio: number;
      stockMax: number;
      mermaPorcentaje: number;
      existe: boolean;
    }> = [];
    let creados = 0;
    let existentes = 0;

    for (const tipoNombre of filtros.tipos) {
      const tipoConfig = tiposConfigMap.get(this.normalizarTexto(tipoNombre));
      const tipoAbreviacion =
        tipoConfig?.abreviacion ||
        (filtros.tipos.length === 1 ? filtros.tipoAbreviacion : '') ||
        this.abreviarPalabras(tipoNombre);
      const categoriaNombre = filtros.categoria || tipoConfig?.categoria || tipoNombre;
      const categoria = categoriaMap.get(this.normalizarTexto(categoriaNombre));

      if (!categoria) {
        throw new ConflictException(`Falta la categoria requerida: ${categoriaNombre}`);
      }

      for (const generoNombre of filtros.generos) {
        const generoConfig = generosConfigMap.get(this.normalizarTexto(generoNombre));
        const generoAbreviacion = generoConfig?.abreviacion || this.abreviarPalabras(generoNombre);

        for (const tela of telasSeleccionadas.filter((item): item is CatalogoItem => Boolean(item))) {
          const telaAbreviacion =
            telasConfigMap.get(this.normalizarTexto(tela.nombre))?.abreviacion ||
            this.abreviarPalabras(tela.nombre);

          for (const talla of tallasSeleccionadas.filter((item): item is CatalogoItem => Boolean(item))) {
            const tallaNombre = this.normalizarTexto(talla.nombre);

            for (const color of coloresSeleccionados.filter((item): item is CatalogoItem => Boolean(item))) {
              const codigoBase = `${tipoAbreviacion}${generoAbreviacion}${telaAbreviacion}${tallaNombre}`;
              const { codigo, existe } = this.seleccionarCodigoCreacionMasiva(
                codigoBase,
                color.nombre,
                massConfig.colorAbreviaciones || {},
                codigosExistentes,
                codigosPlaneados,
              );

              if (existe) {
                existentes += 1;
              } else {
                if (persistir) {
                  await this.prisma.producto.create({
                    data: {
                      codigo,
                      nombre: tipoNombre,
                      genero: generoNombre,
                      tipo: tipoNombre,
                      precio: valores.precio,
                      stockMax: valores.stockMax,
                      mermaPorcentaje: valores.mermaPorcentaje,
                      categoriaId: categoria.id,
                      telaId: tela.id,
                      tallaId: talla.id,
                      colorId: color.id,
                    },
                  });
                }
                creados += 1;
                codigosPlaneados.add(this.normalizarTexto(codigo));
              }

              if (resultados.length < 20) {
                resultados.push({
                  codigo,
                  tipo: tipoNombre,
                  genero: generoNombre,
                  tela: tela.nombre,
                  talla: talla.nombre,
                  color: color.nombre,
                  precio: valores.precio,
                  stockMax: valores.stockMax,
                  mermaPorcentaje: valores.mermaPorcentaje,
                  existe,
                });
              }
            }
          }
        }
      }
    }

    return {
      persistido: persistir,
      creados: persistir ? creados : 0,
      seCrearian: persistir ? 0 : creados,
      existentes,
      totalCombinaciones: creados + existentes,
      filtros,
      valores,
      muestras: resultados,
    };
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

  private parseFiltroLista(raw: unknown): string[] {
    const values = Array.isArray(raw)
      ? raw
      : typeof raw === 'string'
        ? raw.split(',')
        : [];

    return Array.from(
      new Set(
        values
          .map((value) => `${value || ''}`.trim())
          .filter(Boolean),
      ),
    );
  }

  private coincideFiltro(value: string | null | undefined, filtros: string[]) {
    if (!filtros.length) return true;
    const normalizado = this.normalizarTexto(value);
    return filtros.some((filtro) => normalizado === this.normalizarTexto(filtro));
  }

  private normalizeActualizacionFiltros(raw: ActualizacionMasivaPayload['filtros']) {
    return {
      tipos: this.parseFiltroLista(raw?.tipos),
      generos: this.parseFiltroLista(raw?.generos),
      telas: this.parseFiltroLista(raw?.telas),
      tallas: this.parseFiltroLista(raw?.tallas),
      colores: this.parseFiltroLista(raw?.colores),
    };
  }

  private normalizeActualizacionCambios(raw: ActualizacionMasivaPayload['cambios']) {
    const cambios: {
      precio?: number;
      stockMax?: number;
      mermaPorcentaje?: number;
    } = {};

    const precio = Number(raw?.precio);
    const stockMax = Number(raw?.stockMax);
    const mermaPorcentaje = Number(raw?.mermaPorcentaje);

    if (raw?.precio !== undefined && Number.isFinite(precio)) {
      cambios.precio = precio;
    }
    if (raw?.stockMax !== undefined && Number.isFinite(stockMax)) {
      cambios.stockMax = stockMax;
    }
    if (raw?.mermaPorcentaje !== undefined && Number.isFinite(mermaPorcentaje)) {
      cambios.mermaPorcentaje = mermaPorcentaje;
    }

    return cambios;
  }

  private normalizeCreacionMasivaValores(raw: CreacionMasivaPayload['valores']) {
    const precio = Number(raw?.precio);
    const stockMax = Number(raw?.stockMax);
    const mermaPorcentaje = Number(raw?.mermaPorcentaje);

    return {
      precio: Number.isFinite(precio) ? precio : DEFAULT_PRODUCTOS_MASS_CONFIG.precio,
      stockMax: Number.isFinite(stockMax) ? stockMax : DEFAULT_PRODUCTOS_MASS_CONFIG.stockMax,
      mermaPorcentaje: Number.isFinite(mermaPorcentaje)
        ? mermaPorcentaje
        : DEFAULT_PRODUCTOS_MASS_CONFIG.mermaPorcentaje,
    };
  }

  private abreviarPalabras(nombre?: string | null) {
    const limpio = this.normalizarTexto(nombre);
    const partes = limpio.split(/\s+/).filter(Boolean);
    if (!partes.length) return '';
    if (partes.length === 1) return partes[0].slice(0, Math.min(2, partes[0].length));
    return partes.map((parte) => parte[0] || '').join('').slice(0, 3);
  }

  private seleccionarCodigoCreacionMasiva(
    codigoBase: string,
    colorNombre: string,
    colorOverrides: Record<string, string>,
    codigosExistentes: Set<string>,
    codigosPlaneados: Set<string>,
  ) {
    const candidatos = this.crearCandidatosAbreviacionColor(
      colorNombre,
      colorOverrides[this.normalizarTexto(colorNombre)],
    );

    for (const candidato of candidatos) {
      const codigo = this.normalizarTexto(`${codigoBase}${candidato}`);
      if (!codigosExistentes.has(codigo) && !codigosPlaneados.has(codigo)) {
        return { codigo, existe: false };
      }
    }

    const codigo = this.normalizarTexto(`${codigoBase}${candidatos[0] || this.abreviarColor(colorNombre)}`);
    return { codigo, existe: true };
  }

  private crearCandidatosAbreviacionColor(colorNombre: string, override?: string) {
    const candidatos: string[] = [];
    const add = (value: string) => {
      const clean = this.normalizarTexto(value);
      if (clean && !candidatos.includes(clean)) {
        candidatos.push(clean);
      }
    };

    if (override) add(override);

    const limpio = this.normalizarTexto(colorNombre);
    const partes = limpio.split(/\s+/).filter(Boolean);
    if (!partes.length) return candidatos.length ? candidatos : [''];

    if (partes.length >= 2) {
      add(`${partes[0][0] || ''}${partes[1][0] || ''}`);
      for (let length = 2; length <= partes[1].length; length += 1) {
        add(`${partes[0][0] || ''}${partes[1].slice(0, length)}`);
      }
      add(partes.map((parte) => parte[0] || '').join(''));
    } else {
      for (let length = 2; length <= partes[0].length; length += 1) {
        add(partes[0].slice(0, length));
      }
    }

    return candidatos;
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
