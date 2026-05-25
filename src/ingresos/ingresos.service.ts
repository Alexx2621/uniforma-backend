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

  async crearIngreso(data: any, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    await assertBodegaAccess(this.prisma, user, Number(data.bodegaId), 'ajustes');
    const folioResp = user?.id
      ? await this.correlativos.generarUsuarioOperacionCorrelativo(Number(user.id), 'ingresoInventario')
      : null;
    // 1) Crear cabecera
    const ingreso = await this.prisma.ingresoInventario.create({
      data: {
        folio: folioResp?.correlativo || null,
        bodegaId: data.bodegaId,
        observaciones: data.observaciones || null,
        responsable: data.responsable || null,
      },
    });

    // 2) Registrar detalle + actualizar stock
    for (const item of data.detalle) {
      const producto = await this.prisma.producto.findUnique({
        where: { id: item.productoId },
        select: { stockMax: true },
      });

      const inventario = await this.prisma.inventario.findUnique({
        where: {
          bodegaId_productoId: {
            bodegaId: data.bodegaId,
            productoId: item.productoId,
          },
        },
      });

      const stockActual = inventario?.stock ?? 0;
      const stockMax = producto?.stockMax ?? 0;
      if (stockMax > 0 && stockActual + item.cantidad > stockMax) {
        const disponible = stockMax - stockActual;
        throw new BadRequestException(
          `No se puede ingresar mas de ${disponible < 0 ? 0 : disponible} unidades del producto ${item.productoId} en esta bodega (stock max ${stockMax})`,
        );
      }

      await this.prisma.detalleIngreso.create({
        data: {
          ingresoId: ingreso.id,
          productoId: item.productoId,
          cantidad: item.cantidad,
        },
      });

      // 3) Actualizar inventario
      try {
        await this.prisma.inventario.update({
          where: {
            bodegaId_productoId: {
              bodegaId: data.bodegaId,
              productoId: item.productoId,
            },
          },
          data: {
            stock: {
              increment: item.cantidad,
            },
          },
        });
      } catch {
        await this.prisma.inventario.create({
          data: {
            bodegaId: data.bodegaId,
            productoId: item.productoId,
            stock: item.cantidad,
          },
        });
      }

      // 4) Registrar movimiento log
      await this.prisma.movInventario.create({
        data: {
          bodegaId: data.bodegaId,
          productoId: item.productoId,
          tipo: 'ingreso',
          cantidad: item.cantidad,
          referencia: ingreso.folio || `Ingreso #${ingreso.id}`,
        },
      });
    }

    // 5) Retornar ingreso con detalle
    return this.prisma.ingresoInventario.findUnique({
      where: { id: ingreso.id },
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
    });
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
        return { linea: index + 1, codigo, cantidad: Number(cantidad || 0) };
      })
      .filter((item) => {
        const lower = `${item.codigo || ''}`.trim().toLowerCase();
        return lower && lower !== 'codigo' && lower !== 'código';
      });
  }

  private async parseExcelImport(fileBase64: string) {
    const Excel = require('exceljs');
    const workbook = new Excel.Workbook();
    const buffer = Buffer.from(`${fileBase64 || ''}`.split(',').pop() || '', 'base64');
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const rows: Array<{ linea: number; codigo: string; cantidad: number }> = [];
    sheet.eachRow((row: any, rowNumber: number) => {
      const first = `${row.getCell(1).value || ''}`.trim();
      const secondRaw = row.getCell(2).value;
      const second = typeof secondRaw === 'object' && secondRaw !== null && 'result' in secondRaw ? (secondRaw as any).result : secondRaw;
      const codigo = first;
      const cantidad = Number(second || 0);
      const lower = codigo.toLowerCase();
      if (!codigo || lower === 'codigo' || lower === 'código') return;
      rows.push({ linea: rowNumber, codigo, cantidad });
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

    const codigos = Array.from(new Set(parsed.map((row) => `${row.codigo || ''}`.trim()).filter(Boolean)));
    const productos = await this.prisma.producto.findMany({
      where: { codigo: { in: codigos } },
      include: {
        tela: true,
        talla: true,
        color: true,
      },
    });
    const porCodigo = new Map(productos.map((producto) => [producto.codigo, producto]));
    const acumulado = new Map<string, number>();

    const rows = parsed.map((row) => {
      const codigo = `${row.codigo || ''}`.trim();
      const producto = porCodigo.get(codigo);
      const cantidad = Number(row.cantidad || 0);
      const errores: string[] = [];
      if (!codigo) errores.push('Codigo vacio');
      if (!producto) errores.push('Producto no existe');
      if (!Number.isFinite(cantidad) || cantidad <= 0) errores.push('Cantidad invalida');
      acumulado.set(codigo, (acumulado.get(codigo) || 0) + 1);
      return {
        linea: row.linea,
        codigo,
        cantidad,
        productoId: producto?.id || null,
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
      advertencias: acumulado.get(row.codigo) && acumulado.get(row.codigo)! > 1 ? ['Codigo repetido, se acumulara al importar'] : [],
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
