import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { assertBodegaAccess, getAllowedBodegaIds } from '../bodegas/bodega-access';
import { CorrelativosService } from '../correlativos/correlativos.service';

@Injectable()
export class IngresosService {
  constructor(
    private prisma: PrismaService,
    private correlativos: CorrelativosService,
  ) {}

  private readonly ingresoInclude = {
    bodega: true,
    detalle: {
      include: {
        producto: {
          include: {
            tela: true,
            talla: true,
            color: true,
          },
        },
      },
    },
  };

  private normalizeRequestId(value: any) {
    const requestId = `${value || ''}`.trim();
    return requestId.length ? requestId.slice(0, 191) : null;
  }

  private findIngresoByRequestId(requestId: string) {
    return this.prisma.ingresoInventario.findUnique({
      where: { requestId },
      include: this.ingresoInclude,
    });
  }

  async crearIngreso(data: any, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const bodegaId = Number(data.bodegaId || 0);
    const detalle = Array.isArray(data.detalle) ? data.detalle : [];
    const requestId = this.normalizeRequestId(data.requestId || data.clientRequestId);

    if (!bodegaId) throw new BadRequestException('Selecciona una bodega');
    if (!detalle.length) throw new BadRequestException('Agrega al menos un producto');

    if (requestId) {
      const existente = await this.findIngresoByRequestId(requestId);
      if (existente) return existente;
    }

    await assertBodegaAccess(this.prisma, user, bodegaId, 'ajustes');
    const folioResp = user?.id
      ? await this.correlativos.generarUsuarioOperacionCorrelativo(Number(user.id), 'ingresoInventario')
      : null;

    try {
      const ingresoId = await this.prisma.$transaction(async (tx) => {
        const ingreso = await tx.ingresoInventario.create({
          data: {
            folio: folioResp?.correlativo || null,
            requestId,
            bodegaId,
            observaciones: data.observaciones || null,
            responsable: data.responsable || null,
          },
        });

        for (const item of detalle) {
          const productoId = Number(item.productoId || 0);
          const cantidad = Number(item.cantidad || 0);
          if (!productoId || cantidad <= 0) {
            throw new BadRequestException('Todos los productos del ingreso deben tener cantidad mayor a 0');
          }

          const producto = await tx.producto.findUnique({
            where: { id: productoId },
            select: { stockMax: true },
          });

          const inventario = await tx.inventario.findUnique({
            where: {
              bodegaId_productoId: {
                bodegaId,
                productoId,
              },
            },
          });

          const stockActual = inventario?.stock ?? 0;
          const stockMax = producto?.stockMax ?? 0;
          if (stockMax > 0 && stockActual + cantidad > stockMax) {
            const disponible = stockMax - stockActual;
            throw new BadRequestException(
              `No se puede ingresar mas de ${disponible < 0 ? 0 : disponible} unidades del producto ${productoId} en esta bodega (stock max ${stockMax})`,
            );
          }

          await tx.detalleIngreso.create({
            data: {
              ingresoId: ingreso.id,
              productoId,
              cantidad,
            },
          });

          await tx.inventario.upsert({
            where: {
              bodegaId_productoId: {
                bodegaId,
                productoId,
              },
            },
            update: {
              stock: {
                increment: cantidad,
              },
            },
            create: {
              bodegaId,
              productoId,
              stock: cantidad,
            },
          });

          await tx.movInventario.create({
            data: {
              bodegaId,
              productoId,
              tipo: 'ingreso',
              cantidad,
              referencia: ingreso.folio || `Ingreso #${ingreso.id}`,
            },
          });
        }

        return ingreso.id;
      });

      return this.prisma.ingresoInventario.findUnique({
        where: { id: ingresoId },
        include: this.ingresoInclude,
      });
    } catch (error: any) {
      if (requestId && error?.code === 'P2002') {
        const existente = await this.findIngresoByRequestId(requestId);
        if (existente) return existente;
      }
      throw error;
    }
  }

  async importar(data: any, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const bodegaId = Number(data.bodegaId || 0);
    const items = Array.isArray(data.items) ? data.items : [];
    if (!bodegaId) throw new BadRequestException('Selecciona una bodega');
    if (!items.length) throw new BadRequestException('No hay articulos para importar');

    const codigos = items.map((item: any) => `${item.codigo || ''}`.trim()).filter(Boolean);
    const productos = await this.prisma.producto.findMany({
      where: { codigo: { in: codigos } },
      select: { id: true, codigo: true },
    });
    const porCodigo = new Map(productos.map((producto) => [producto.codigo, producto.id]));
    const noEncontrados = codigos.filter((codigo: string) => !porCodigo.has(codigo));
    if (noEncontrados.length) {
      throw new BadRequestException(`No se encontraron estos codigos: ${noEncontrados.join(', ')}`);
    }

    const acumulado = new Map<number, number>();
    for (const item of items) {
      const codigo = `${item.codigo || ''}`.trim();
      const productoId = porCodigo.get(codigo);
      const cantidad = Number(item.cantidad || 0);
      if (!productoId || cantidad <= 0) continue;
      acumulado.set(productoId, (acumulado.get(productoId) || 0) + cantidad);
    }
    if (!acumulado.size) throw new BadRequestException('Las cantidades importadas deben ser mayores a 0');

    return this.crearIngreso(
      {
        bodegaId,
        requestId: data.requestId || data.clientRequestId,
        responsable: data.responsable,
        observaciones: data.observaciones || 'Importacion masiva de inventario',
        detalle: Array.from(acumulado.entries()).map(([productoId, cantidad]) => ({ productoId, cantidad })),
      },
      user,
    );
  }

  private parsePlainImport(raw: string) {
    return `${raw || ''}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const [codigo, cantidad] = line.split(/[,\t;]/).map((value) => value.trim());
        return { linea: index + 1, codigo, cantidad: Number(cantidad || 0), formato: 'codigo' };
      })
      .filter((item) => {
        const lower = `${item.codigo || ''}`.trim().toLowerCase();
        return lower && lower !== 'codigo' && lower !== 'código';
      });
  }

  private getExcelCellText(cell: any) {
    const value = cell?.value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      if ('result' in value) return `${value.result ?? ''}`.trim();
      if ('text' in value) return `${value.text ?? ''}`.trim();
      if ('richText' in value && Array.isArray(value.richText)) {
        return value.richText.map((part: any) => part?.text || '').join('').trim();
      }
    }
    return `${value}`.trim();
  }

  private getExcelCellNumber(cell: any) {
    const value = cell?.value;
    const raw =
      value && typeof value === 'object' && 'result' in value
        ? (value as any).result
        : value;
    if (typeof raw === 'number') return raw;
    return Number(`${raw ?? ''}`.trim().replace(/,/g, '.') || 0);
  }

  private normalizarTexto(value: unknown) {
    return `${value || ''}`
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  private normalizarTalla(value: unknown) {
    return this.normalizarTexto(value).replace(/\s+/g, '');
  }

  private crearProductoMatrizKey(tipo: unknown, genero: unknown, tela: unknown, talla: unknown, color: unknown) {
    return [
      this.normalizarTexto(tipo),
      this.normalizarTexto(genero),
      this.normalizarTexto(tela),
      this.normalizarTalla(talla),
      this.normalizarTexto(color),
    ].join('|');
  }

  private resolverColorInterno(color: unknown, aliases: Map<string, string>) {
    const normalizado = this.normalizarTexto(color);
    return aliases.get(normalizado) || normalizado;
  }

  private parseExcelMatrixImport(sheet: any) {
    const headerRowNumber = Array.from({ length: Math.min(sheet.rowCount, 12) }, (_, index) => index + 1).find(
      (rowNumber) => this.normalizarTexto(this.getExcelCellText(sheet.getRow(rowNumber).getCell(1))) === 'TALLAS',
    );
    if (!headerRowNumber) return [];

    const dataRow = sheet.getRow(2);
    const tela = this.getExcelCellText(dataRow.getCell(1));
    const genero = this.getExcelCellText(dataRow.getCell(2));
    const tipo = this.getExcelCellText(dataRow.getCell(3));
    const headerRow = sheet.getRow(headerRowNumber);
    const colores: Array<{ colNumber: number; nombre: string }> = [];
    const maxColumn = Math.max(sheet.columnCount || 0, sheet.actualColumnCount || 0, headerRow.cellCount || 0);
    for (let colNumber = 2; colNumber <= maxColumn; colNumber += 1) {
      const nombre = this.getExcelCellText(headerRow.getCell(colNumber));
      if (nombre) colores.push({ colNumber, nombre });
    }
    if (!tela || !genero || !tipo || !colores.length) return [];

    const rows: Array<{
      linea: number;
      codigo: string;
      cantidad: number;
      tipo: string;
      genero: string;
      tela: string;
      talla: string;
      color: string;
      formato: string;
    }> = [];

    for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const talla = this.getExcelCellText(row.getCell(1));
      if (!talla) continue;

      for (const color of colores) {
        const cantidad = this.getExcelCellNumber(row.getCell(color.colNumber));
        if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
        rows.push({
          linea: rowNumber,
          codigo: '',
          cantidad,
          tipo,
          genero,
          tela,
          talla,
          color: color.nombre,
          formato: 'matriz',
        });
      }
    }

    return rows;
  }

  private async parseExcelImport(fileBase64: string) {
    const Excel = require('exceljs');
    const workbook = new Excel.Workbook();
    const buffer = Buffer.from(`${fileBase64 || ''}`.split(',').pop() || '', 'base64');
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const matrixRows = this.parseExcelMatrixImport(sheet);
    if (matrixRows.length) return matrixRows;
    const rows: Array<{ linea: number; codigo: string; cantidad: number; formato: string }> = [];
    sheet.eachRow((row: any, rowNumber: number) => {
      const first = this.getExcelCellText(row.getCell(1));
      const second = this.getExcelCellNumber(row.getCell(2));
      const codigo = first;
      const cantidad = Number(second || 0);
      const lower = codigo.toLowerCase();
      if (!codigo || lower === 'codigo' || lower === 'código') return;
      rows.push({ linea: rowNumber, codigo, cantidad, formato: 'codigo' });
    });
    return rows;
  }

  async previewImportacion(data: any, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const bodegaId = Number(data.bodegaId || 0);
    if (!bodegaId) throw new BadRequestException('Selecciona una bodega');
    await assertBodegaAccess(this.prisma, user, bodegaId, 'ajustes');

    const parsed = data.fileBase64
      ? await this.parseExcelImport(data.fileBase64)
      : this.parsePlainImport(`${data.raw || ''}`);
    if (!parsed.length) throw new BadRequestException('No se encontraron filas validas para importar');

    const codigos = Array.from(new Set(parsed.map((row: any) => `${row.codigo || ''}`.trim()).filter(Boolean)));
    const hasMatrixRows = parsed.some((row: any) => row.formato === 'matriz');
    const productos = await this.prisma.producto.findMany({
      where: hasMatrixRows ? {} : { codigo: { in: codigos } },
      include: {
        tela: true,
        talla: true,
        color: true,
      },
    });
    const colorAliases = hasMatrixRows
      ? await this.prisma.colorProveedorAlias.findMany({
          where: { activo: true },
          include: { color: true },
        })
      : [];
    const coloresProveedor = new Map<string, string>();
    colorAliases.forEach((alias: any) => {
      const colorInterno = this.normalizarTexto(alias.color?.nombre);
      if (!colorInterno) return;
      const nombreProveedor = this.normalizarTexto(alias.nombreProveedor);
      const codigoProveedor = this.normalizarTexto(alias.codigoProveedor);
      if (nombreProveedor && !coloresProveedor.has(nombreProveedor)) coloresProveedor.set(nombreProveedor, colorInterno);
      if (codigoProveedor && !coloresProveedor.has(codigoProveedor)) coloresProveedor.set(codigoProveedor, colorInterno);
    });
    const porCodigo = new Map(productos.map((producto) => [producto.codigo, producto]));
    const porPropiedades = new Map(
      productos.map((producto) => [
        this.crearProductoMatrizKey(
          producto.tipo,
          producto.genero,
          producto.tela?.nombre,
          producto.talla?.nombre,
          producto.color?.nombre,
        ),
        producto,
      ]),
    );
    const acumulado = new Map<string, number>();

    const rows = parsed.map((row: any) => {
      const producto =
        row.formato === 'matriz'
          ? porPropiedades.get(
              this.crearProductoMatrizKey(
                row.tipo,
                row.genero,
                row.tela,
                row.talla,
                this.resolverColorInterno(row.color, coloresProveedor),
              ),
            )
          : porCodigo.get(`${row.codigo || ''}`.trim());
      const codigo = `${row.codigo || producto?.codigo || ''}`.trim();
      const cantidad = Number(row.cantidad || 0);
      const errores: string[] = [];
      if (!codigo && row.formato !== 'matriz') errores.push('Codigo vacio');
      if (!producto) {
        errores.push(
          row.formato === 'matriz'
            ? `Producto no existe para ${[row.tipo, row.genero, row.tela, row.talla, row.color].filter(Boolean).join(' / ')}`
            : 'Producto no existe',
        );
      }
      if (!Number.isFinite(cantidad) || cantidad <= 0) errores.push('Cantidad invalida');
      if (codigo) {
        acumulado.set(codigo, (acumulado.get(codigo) || 0) + 1);
      }
      return {
        linea: row.linea,
        codigo,
        cantidad,
        productoId: producto?.id || null,
        formato: row.formato || 'codigo',
        tipoDetectado: row.tipo || null,
        generoDetectado: row.genero || null,
        telaDetectada: row.tela || null,
        tallaDetectada: row.talla || null,
        colorDetectado: row.color || null,
        colorInternoDetectado:
          row.formato === 'matriz' ? this.resolverColorInterno(row.color, coloresProveedor) || null : null,
        producto: producto
          ? {
              id: producto.id,
              nombre: producto.nombre,
              tipo: producto.tipo,
              genero: producto.genero,
              tela: producto.tela?.nombre || null,
              talla: producto.talla?.nombre || null,
              color: producto.color?.nombre || null,
            }
          : null,
        errores,
      };
    });

    const rowsConDuplicados = rows.map((row) => ({
      ...row,
      advertencias: row.codigo && acumulado.get(row.codigo) && acumulado.get(row.codigo)! > 1 ? ['Codigo repetido, se acumulara al importar'] : [],
      valido: row.errores.length === 0,
    }));
    const validas = rowsConDuplicados.filter((row) => row.valido);
    const invalidas = rowsConDuplicados.filter((row) => !row.valido);

    const itemsAcumulados = new Map<number, { productoId: number; codigo: string; cantidad: number }>();
    validas.forEach((row) => {
      const productoId = Number(row.productoId);
      const current = itemsAcumulados.get(productoId);
      itemsAcumulados.set(productoId, {
        productoId,
        codigo: row.codigo,
        cantidad: (current?.cantidad || 0) + Number(row.cantidad || 0),
      });
    });

    return {
      bodegaId,
      totalFilas: rowsConDuplicados.length,
      filasValidas: validas.length,
      filasInvalidas: invalidas.length,
      totalUnidades: validas.reduce((sum, row) => sum + Number(row.cantidad || 0), 0),
      rows: rowsConDuplicados,
      items: Array.from(itemsAcumulados.values()),
    };
  }

  async findAll(query: any = {}, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const where: any = {};
    const desde = query.desde ? new Date(`${query.desde}T00:00:00`) : null;
    const hasta = query.hasta ? new Date(`${query.hasta}T23:59:59.999`) : null;
    if (desde || hasta) {
      where.fecha = {
        ...(desde ? { gte: desde } : {}),
        ...(hasta ? { lte: hasta } : {}),
      };
    }

    const bodegaId = Number(query.bodegaId || 0);
    const allowedIds = await getAllowedBodegaIds(this.prisma, user, 'ajustes');
    if (bodegaId > 0) {
      await assertBodegaAccess(this.prisma, user, bodegaId, 'ajustes');
      where.bodegaId = bodegaId;
    } else if (allowedIds !== null) {
      where.bodegaId = { in: allowedIds.length ? allowedIds : [-1] };
    }

    const responsable = `${query.responsable || ''}`.trim();
    if (responsable) {
      where.responsable = { contains: responsable };
    }

    return this.prisma.ingresoInventario.findMany({
      where,
      include: {
        bodega: true,
        detalle: {
          include: {
            producto: {
              include: {
                tela: true,
                talla: true,
                color: true,
              },
            },
          },
        },
      },
      orderBy: { fecha: 'desc' },
    });
  }
}
