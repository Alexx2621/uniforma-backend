import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { buildBodegaWhere } from '../bodegas/bodega-access';
import { paginatedResponse, parsePaginationQuery } from '../common/pagination';

const optionalInt = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new BadRequestException('Identificador no valido');
  return parsed;
};

const positiveNumber = (value: unknown, field: string, allowZero = true) => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed <= 0)) {
    throw new BadRequestException(`${field} no valido`);
  }
  return parsed;
};

const cleanText = (value: unknown) => {
  const text = `${value ?? ''}`.trim();
  return text || null;
};

const normalizeText = (value: unknown) =>
  `${value ?? ''}`.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

@Injectable()
export class InventarioTelasService {
  constructor(private prisma: PrismaService) {}

  private isAdmin(user?: { rol?: string | null }) {
    return `${user?.rol || ''}`.trim().toUpperCase() === 'ADMIN';
  }

  private hasPermission(user: { permisos?: string[] | null } | undefined, permission: string) {
    return Array.isArray(user?.permisos) && user.permisos.includes(permission);
  }

  private async buildBodegaWhere(user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const where = await buildBodegaWhere(this.prisma, user, 'stock');
    if (!Object.keys(where).length) return {};
    const bodegaIds = (where as any).bodegaId?.in || [];
    return { OR: [{ bodegaId: { in: bodegaIds.length ? bodegaIds : [-1] } }, { bodegaId: null }] };
  }

  private normalizeRollo(body: any, partial = false) {
    const data: any = {};
    if (!partial || body.codigo !== undefined) data.codigo = cleanText(body.codigo)?.toUpperCase() || this.generarCodigoRollo();
    if (!partial || body.telaId !== undefined) {
      const telaId = optionalInt(body.telaId);
      if (!telaId) throw new BadRequestException('Selecciona la tela');
      data.telaId = telaId;
    }
    if (!partial || body.colorId !== undefined) data.colorId = optionalInt(body.colorId);
    if (!partial || body.bodegaId !== undefined) {
      const bodegaId = optionalInt(body.bodegaId);
      if (!partial && !bodegaId) throw new BadRequestException('Selecciona la bodega');
      data.bodegaId = bodegaId;
    }
    if (!partial || body.proveedorId !== undefined) data.proveedorId = optionalInt(body.proveedorId);
    if (!partial || body.proveedor !== undefined) data.proveedor = cleanText(body.proveedor);
    if (!partial || body.lote !== undefined) data.lote = cleanText(body.lote);
    if (!partial || body.tono !== undefined) data.tono = cleanText(body.tono);
    if (!partial || body.ancho !== undefined) data.ancho = positiveNumber(body.ancho, 'Ancho');
    if (!partial || body.unidad !== undefined) data.unidad = cleanText(body.unidad) || 'metros';
    if (!partial || body.cantidadInicial !== undefined) data.cantidadInicial = positiveNumber(body.cantidadInicial, 'Cantidad inicial');
    if (!partial || body.cantidadDisponible !== undefined) {
      data.cantidadDisponible = positiveNumber(body.cantidadDisponible ?? body.cantidadInicial, 'Cantidad disponible');
    }
    if (!partial || body.costoUnitario !== undefined) data.costoUnitario = positiveNumber(body.costoUnitario, 'Costo unitario');
    if (!partial || body.ubicacion !== undefined) data.ubicacion = cleanText(body.ubicacion);
    if (!partial || body.estado !== undefined) data.estado = cleanText(body.estado) || 'disponible';
    if (!partial || body.fechaIngreso !== undefined) {
      data.fechaIngreso = body.fechaIngreso ? new Date(`${body.fechaIngreso}`) : new Date();
      if (Number.isNaN(data.fechaIngreso.getTime())) throw new BadRequestException('Fecha de ingreso no valida');
    }
    if (!partial || body.observaciones !== undefined) data.observaciones = cleanText(body.observaciones);
    return data;
  }

  private generarCodigoRollo() {
    const suffix = Date.now().toString(36).toUpperCase();
    return `RT-${suffix}`;
  }

  listarRollos(query: any, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    return this.listarRollosInterno(query, user);
  }

  private async listarRollosInterno(query: any, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const where: any = await this.buildBodegaWhere(user);
    const and: any[] = [];
    if (Object.keys(where).length) and.push(where);
    if (query?.telaId) and.push({ telaId: Number(query.telaId) });
    if (query?.colorId) and.push({ colorId: Number(query.colorId) });
    if (query?.bodegaId) and.push({ bodegaId: Number(query.bodegaId) });
    if (query?.proveedorId) and.push({ proveedorId: Number(query.proveedorId) });
    if (query?.estado) and.push({ estado: `${query.estado}` });
    const search = cleanText(query?.q);
    if (search) {
      and.push({
        OR: [
          { codigo: { contains: search } },
          { proveedor: { contains: search } },
          { lote: { contains: search } },
          { tono: { contains: search } },
          { tela: { nombre: { contains: search } } },
          { color: { nombre: { contains: search } } },
          { proveedorRef: { nombre: { contains: search } } },
          { proveedorRef: { nit: { contains: search } } },
        ],
      });
    }

    return this.prisma.telaRollo.findMany({
      where: and.length ? { AND: and } : {},
      include: { tela: true, color: true, bodega: true, proveedorRef: true },
      orderBy: [{ fechaIngreso: 'desc' }, { id: 'desc' }],
    });
  }

  async resumen(query: any, user?: { id?: number; rol?: string | null; permisos?: string[] | null }) {
    const rollos = await this.listarRollosInterno(query, user);
    const totalDisponible = rollos.reduce((sum, row) => sum + Number(row.cantidadDisponible || 0), 0);
    const totalInicial = rollos.reduce((sum, row) => sum + Number(row.cantidadInicial || 0), 0);
    const valorEstimado = rollos.reduce((sum, row) => sum + Number(row.cantidadDisponible || 0) * Number(row.costoUnitario || 0), 0);
    const agotados = rollos.filter((row) => Number(row.cantidadDisponible || 0) <= 0).length;
    const porTela = new Map<number, any>();
    for (const row of rollos) {
      const key = Number(row.telaId);
      if (!porTela.has(key)) {
        porTela.set(key, {
          telaId: key,
          tela: row.tela?.nombre || 'N/D',
          rollos: 0,
          cantidadDisponible: 0,
          valorEstimado: 0,
        });
      }
      const item = porTela.get(key);
      item.rollos += 1;
      item.cantidadDisponible += Number(row.cantidadDisponible || 0);
      item.valorEstimado += Number(row.cantidadDisponible || 0) * Number(row.costoUnitario || 0);
    }
    return {
      rollos: rollos.length,
      totalInicial,
      totalDisponible,
      valorEstimado,
      agotados,
      porTela: Array.from(porTela.values()).sort((a, b) => b.cantidadDisponible - a.cantidadDisponible),
    };
  }

  async crearRollo(body: any, user?: { id?: number }) {
    const data = this.normalizeRollo(body);
    if (data.cantidadDisponible === undefined) data.cantidadDisponible = data.cantidadInicial;
    const created = await this.prisma.telaRollo
      .create({
        data: {
          ...data,
          movimientos: {
            create: {
              tipo: 'ingreso',
              cantidad: Number(data.cantidadInicial || 0),
              fecha: data.fechaIngreso || new Date(),
              referencia: data.codigo,
              motivo: 'Ingreso inicial del rollo',
              observaciones: data.observaciones,
              usuarioId: Number(user?.id || 0) || null,
            },
          },
        },
        include: { tela: true, color: true, bodega: true, proveedorRef: true },
      })
      .catch((error) => {
        if (error?.code === 'P2002') throw new ConflictException('Ya existe un rollo con ese codigo');
        throw error;
      });
    return created;
  }

  async actualizarRollo(id: number, body: any) {
    await this.ensureRollo(id);
    const data = this.normalizeRollo(body, true);
    return this.prisma.telaRollo.update({
      where: { id },
      data,
      include: { tela: true, color: true, bodega: true, proveedorRef: true },
    });
  }

  async eliminarRollo(id: number) {
    await this.ensureRollo(id);
    const movimientos = await this.prisma.movimientoTela.count({ where: { rolloId: id } });
    if (movimientos > 1) throw new ConflictException('No se puede eliminar un rollo con movimientos registrados');
    await this.prisma.movimientoTela.deleteMany({ where: { rolloId: id } });
    return this.prisma.telaRollo.delete({ where: { id } });
  }

  listarMovimientos(rolloId?: number) {
    return this.prisma.movimientoTela.findMany({
      where: rolloId ? { rolloId } : {},
      include: { rollo: { include: { tela: true, color: true, bodega: true, proveedorRef: true } } },
      orderBy: { fecha: 'desc' },
    });
  }

  async listarIngresos(query: any = {}) {
    const where: any = {};
    if (query.estado) where.estado = `${query.estado}`;
    if (query.proveedorId) where.proveedorId = Number(query.proveedorId);
    const pagination = parsePaginationQuery(query);
    const args: any = {
      where,
      include: {
        proveedor: true,
        facturaProveedor: true,
        detalle: { include: { tela: true, bodega: true, color: true, rollo: true }, orderBy: { linea: 'asc' } },
      },
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      ...(pagination ? { skip: pagination.skip, take: pagination.take } : {}),
    };
    if (!pagination) return this.prisma.ingresoTela.findMany(args);
    const [total, data] = await Promise.all([
      this.prisma.ingresoTela.count({ where }),
      this.prisma.ingresoTela.findMany(args),
    ]);
    return paginatedResponse(data, total, pagination.page, pagination.pageSize);
  }

  async obtenerIngreso(id: number) {
    const ingreso = await this.prisma.ingresoTela.findUnique({
      where: { id },
      include: {
        proveedor: true,
        facturaProveedor: true,
        detalle: { include: { tela: true, bodega: true, color: true, rollo: true }, orderBy: { linea: 'asc' } },
      },
    });
    if (!ingreso) throw new NotFoundException('Ingreso de tela no encontrado');
    return ingreso;
  }

  async crearIngreso(body: any) {
    const proveedorId = optionalInt(body.proveedorId);
    if (!proveedorId) throw new BadRequestException('Selecciona el proveedor');
    const detalles = Array.isArray(body.detalle) ? body.detalle : [];
    if (!detalles.length) throw new BadRequestException('Agrega al menos una linea de tela');
    const count = await this.prisma.ingresoTela.count();
    const correlativo = `IT-${String(count + 1).padStart(5, '0')}`;
    const fecha = body.fecha ? new Date(`${body.fecha}`) : new Date();
    if (Number.isNaN(fecha.getTime())) throw new BadRequestException('Fecha no valida');
    return this.prisma.ingresoTela.create({
      data: {
        correlativo,
        proveedorId,
        documentoTipo: cleanText(body.documentoTipo) || 'recibo',
        documentoReferencia: cleanText(body.documentoReferencia),
        documentoTotal: positiveNumber(body.documentoTotal, 'Total del documento'),
        fecha,
        estado: 'abierto',
        observaciones: cleanText(body.observaciones),
        detalle: {
          create: detalles.map((item: any, index: number) => {
            const cantidad = positiveNumber(item.cantidad, `Cantidad linea ${index + 1}`, false);
            const costoUnitario = positiveNumber(item.costoUnitario, `Costo linea ${index + 1}`);
            const telaId = optionalInt(item.telaId);
            const bodegaId = optionalInt(item.bodegaId);
            return {
              linea: index + 1,
              telaId,
              bodegaId,
              colorId: optionalInt(item.colorId),
              proveedorCodigo: cleanText(item.proveedorCodigo),
              proveedorNombre: cleanText(item.proveedorNombre) || cleanText(item.descripcionFactura) || 'Tela proveedor',
              descripcionFactura: cleanText(item.descripcionFactura) || cleanText(item.proveedorNombre) || 'Ingreso manual de tela',
              cantidad,
              unidad: cleanText(item.unidad) || 'metros',
              costoUnitario,
              total: positiveNumber(item.total ?? cantidad * costoUnitario, `Total linea ${index + 1}`),
              lote: cleanText(item.lote),
              tono: cleanText(item.tono),
              ancho: positiveNumber(item.ancho, `Ancho linea ${index + 1}`),
              ubicacion: cleanText(item.ubicacion),
              estado: telaId && bodegaId ? 'listo' : 'pendiente',
              observaciones: cleanText(item.observaciones),
            };
          }),
        },
      },
      include: {
        proveedor: true,
        facturaProveedor: true,
        detalle: { include: { tela: true, bodega: true, color: true, rollo: true }, orderBy: { linea: 'asc' } },
      },
    });
  }

  async eliminarIngreso(id: number) {
    const ingreso = await this.prisma.ingresoTela.findUnique({
      where: { id },
      include: { detalle: true },
    });
    if (!ingreso) throw new NotFoundException('Ingreso de tela no encontrado');
    if (ingreso.estado !== 'abierto') throw new ConflictException('Solo puedes eliminar ingresos abiertos');
    if (ingreso.detalle.some((item) => item.rolloId)) {
      throw new ConflictException('No puedes eliminar un ingreso que ya tiene rollos creados');
    }
    return this.prisma.ingresoTela.delete({ where: { id } });
  }

  async actualizarIngresoDetalle(id: number, detalleId: number, body: any) {
    await this.obtenerIngreso(id);
    const current = await this.prisma.ingresoTelaDetalle.findUnique({ where: { id: detalleId } });
    if (!current || current.ingresoTelaId !== id) throw new NotFoundException('Linea de ingreso no encontrada');
    const data: any = {};
    if (body.telaId !== undefined) data.telaId = optionalInt(body.telaId);
    if (body.bodegaId !== undefined) data.bodegaId = optionalInt(body.bodegaId);
    if (body.colorId !== undefined) data.colorId = optionalInt(body.colorId);
    if (body.proveedorCodigo !== undefined) data.proveedorCodigo = cleanText(body.proveedorCodigo);
    if (body.proveedorNombre !== undefined) data.proveedorNombre = cleanText(body.proveedorNombre);
    if (body.cantidad !== undefined) data.cantidad = positiveNumber(body.cantidad, 'Cantidad', false);
    if (body.unidad !== undefined) data.unidad = cleanText(body.unidad) || 'metros';
    if (body.costoUnitario !== undefined) data.costoUnitario = positiveNumber(body.costoUnitario, 'Costo unitario');
    if (body.total !== undefined) data.total = positiveNumber(body.total, 'Total');
    if (body.lote !== undefined) data.lote = cleanText(body.lote);
    if (body.tono !== undefined) data.tono = cleanText(body.tono);
    if (body.ancho !== undefined) data.ancho = positiveNumber(body.ancho, 'Ancho');
    if (body.ubicacion !== undefined) data.ubicacion = cleanText(body.ubicacion);
    if (body.observaciones !== undefined) data.observaciones = cleanText(body.observaciones);
    const nextTelaId = data.telaId === undefined ? current.telaId : data.telaId;
    const nextBodegaId = data.bodegaId === undefined ? current.bodegaId : data.bodegaId;
    data.estado = nextTelaId && nextBodegaId ? 'listo' : 'pendiente';
    return this.prisma.ingresoTelaDetalle.update({
      where: { id: detalleId },
      data,
      include: { tela: true, bodega: true, color: true, rollo: true },
    });
  }

  async eliminarIngresoDetalle(id: number, detalleId: number) {
    const ingreso = await this.prisma.ingresoTela.findUnique({
      where: { id },
      include: { detalle: true },
    });
    if (!ingreso) throw new NotFoundException('Ingreso de tela no encontrado');
    if (ingreso.estado !== 'abierto') throw new ConflictException('Solo puedes eliminar lineas de ingresos abiertos');
    const detalle = ingreso.detalle.find((item) => item.id === detalleId);
    if (!detalle) throw new NotFoundException('Linea de ingreso no encontrada');
    if (detalle.rolloId) throw new ConflictException('No puedes eliminar una linea que ya fue ingresada a inventario');
    if (ingreso.detalle.length <= 1) throw new BadRequestException('El ingreso debe conservar al menos una linea');
    await this.prisma.ingresoTelaDetalle.delete({ where: { id: detalleId } });
    const restantes = await this.prisma.ingresoTelaDetalle.findMany({
      where: { ingresoTelaId: id },
      orderBy: { linea: 'asc' },
    });
    await Promise.all(
      restantes.map((item, index) =>
        item.linea === index + 1
          ? Promise.resolve()
          : this.prisma.ingresoTelaDetalle.update({ where: { id: item.id }, data: { linea: index + 1 } }),
      ),
    );
    return this.obtenerIngreso(id);
  }

  async procesarIngreso(id: number, user?: { id?: number }) {
    const ingreso = await this.prisma.ingresoTela.findUnique({
      where: { id },
      include: { proveedor: true, detalle: true },
    });
    if (!ingreso) throw new NotFoundException('Ingreso de tela no encontrado');
    if (ingreso.estado === 'cerrado') throw new ConflictException('Este ingreso ya fue cerrado');
    const pendientes = ingreso.detalle.filter((item) => !item.rolloId);
    if (!pendientes.length) throw new BadRequestException('No hay lineas pendientes de ingresar');
    const incompletas = pendientes.filter((item) => !item.telaId || !item.bodegaId || Number(item.cantidad || 0) <= 0);
    if (incompletas.length) throw new BadRequestException('Todas las lineas deben tener tela, bodega y cantidad mayor a cero');

    return this.prisma.$transaction(async (tx) => {
      const creados: any[] = [];
      for (const item of pendientes) {
        const codigo = `${ingreso.correlativo}-${String(item.linea).padStart(2, '0')}`;
        const rollo = await tx.telaRollo.create({
          data: {
            codigo,
            telaId: Number(item.telaId),
            colorId: item.colorId || null,
            bodegaId: Number(item.bodegaId),
            proveedorId: ingreso.proveedorId || null,
            proveedor: ingreso.proveedor?.nombre || null,
            lote: item.lote,
            tono: item.tono,
            ancho: Number(item.ancho || 0),
            unidad: item.unidad || 'metros',
            cantidadInicial: Number(item.cantidad || 0),
            cantidadDisponible: Number(item.cantidad || 0),
            costoUnitario: Number(item.costoUnitario || 0),
            ubicacion: item.ubicacion,
            estado: 'disponible',
            fechaIngreso: ingreso.fecha || new Date(),
            observaciones: item.observaciones || item.descripcionFactura,
            movimientos: {
              create: {
                tipo: 'ingreso',
                cantidad: Number(item.cantidad || 0),
                fecha: ingreso.fecha || new Date(),
                referencia: ingreso.correlativo,
                motivo: 'Ingreso de tela desde factura proveedor',
                observaciones: item.descripcionFactura,
                usuarioId: Number(user?.id || 0) || null,
              },
            },
          },
        });
        await tx.ingresoTelaDetalle.update({ where: { id: item.id }, data: { rolloId: rollo.id, estado: 'ingresado' } });
        if (ingreso.proveedorId && item.telaId && item.proveedorNombre) {
          const aliases = await tx.telaProveedorAlias.findMany({
            where: { proveedorId: ingreso.proveedorId, telaId: item.telaId },
          });
          const exists = aliases.some((alias: any) => {
            const codigo = normalizeText(alias.codigoProveedor);
            const nombre = normalizeText(alias.nombreProveedor);
            const color = normalizeText(alias.colorProveedor);
            return (
              (codigo && codigo === normalizeText(item.proveedorCodigo)) ||
              (nombre === normalizeText(item.proveedorNombre) && color === normalizeText(item.tono || alias.colorProveedor))
            );
          });
          if (!exists) {
            await tx.telaProveedorAlias.create({
              data: {
                proveedorId: ingreso.proveedorId,
                telaId: item.telaId,
                colorId: item.colorId,
                codigoProveedor: item.proveedorCodigo,
                nombreProveedor: item.proveedorNombre,
                colorProveedor: item.tono,
                unidad: item.unidad || 'metros',
                ancho: Number(item.ancho || 0),
                descripcionProveedor: item.descripcionFactura,
              },
            });
          }
        }
        if (ingreso.proveedorId && item.colorId && item.tono) {
          const colorAliases = await tx.colorProveedorAlias.findMany({
            where: { proveedorId: ingreso.proveedorId, colorId: item.colorId },
          });
          const colorExists = colorAliases.some((alias: any) => {
            const codigo = normalizeText(alias.codigoProveedor);
            const nombre = normalizeText(alias.nombreProveedor);
            return (codigo && codigo === normalizeText(item.proveedorCodigo)) || nombre === normalizeText(item.tono);
          });
          if (!colorExists) {
            await tx.colorProveedorAlias.create({
              data: {
                proveedorId: ingreso.proveedorId,
                colorId: item.colorId,
                codigoProveedor: null,
                nombreProveedor: item.tono,
                descripcionProveedor: item.descripcionFactura,
              },
            });
          }
        }
        creados.push(rollo);
      }
      const restantes = await tx.ingresoTelaDetalle.count({ where: { ingresoTelaId: id, rolloId: null } });
      const updated = await tx.ingresoTela.update({
        where: { id },
        data: { estado: restantes ? 'parcial' : 'cerrado' },
        include: { detalle: true },
      });
      return { ingreso: updated, rollos: creados };
    });
  }

  listarAliases(query: any = {}) {
    const where: any = {};
    if (query.proveedorId) where.proveedorId = Number(query.proveedorId);
    if (query.telaId) where.telaId = Number(query.telaId);
    if (query.colorId) where.colorId = Number(query.colorId);
    if (query.activo !== undefined && query.activo !== '') where.activo = `${query.activo}` === 'true';
    const search = cleanText(query.q);
    if (search) {
      where.OR = [
        { codigoProveedor: { contains: search } },
        { nombreProveedor: { contains: search } },
        { colorProveedor: { contains: search } },
        { descripcionProveedor: { contains: search } },
        { tela: { nombre: { contains: search } } },
        { color: { nombre: { contains: search } } },
        { proveedor: { nombre: { contains: search } } },
      ];
    }
    return this.prisma.telaProveedorAlias.findMany({
      where,
      include: { tela: true, proveedor: true, color: true },
      orderBy: [{ proveedor: { nombre: 'asc' } }, { nombreProveedor: 'asc' }, { colorProveedor: 'asc' }],
    });
  }

  crearAlias(body: any) {
    const data = this.normalizeAlias(body);
    return this.prisma.telaProveedorAlias.create({
      data,
      include: { tela: true, proveedor: true, color: true },
    });
  }

  async actualizarAlias(id: number, body: any) {
    await this.ensureAlias(id);
    const data = this.normalizeAlias(body, true);
    return this.prisma.telaProveedorAlias.update({
      where: { id },
      data,
      include: { tela: true, proveedor: true, color: true },
    });
  }

  async eliminarAlias(id: number) {
    await this.ensureAlias(id);
    return this.prisma.telaProveedorAlias.delete({ where: { id } });
  }

  private normalizeAlias(body: any, partial = false) {
    const data: any = {};
    if (!partial || body.proveedorId !== undefined) {
      const proveedorId = optionalInt(body.proveedorId);
      if (!proveedorId) throw new BadRequestException('Selecciona el proveedor');
      data.proveedorId = proveedorId;
    }
    if (!partial || body.telaId !== undefined) {
      const telaId = optionalInt(body.telaId);
      if (!telaId) throw new BadRequestException('Selecciona la tela interna');
      data.telaId = telaId;
    }
    if (!partial || body.colorId !== undefined) data.colorId = optionalInt(body.colorId);
    if (!partial || body.codigoProveedor !== undefined) data.codigoProveedor = cleanText(body.codigoProveedor);
    if (!partial || body.nombreProveedor !== undefined) {
      const nombreProveedor = cleanText(body.nombreProveedor);
      if (!nombreProveedor) throw new BadRequestException('Ingresa el nombre de tela del proveedor');
      data.nombreProveedor = nombreProveedor;
    }
    if (!partial || body.colorProveedor !== undefined) data.colorProveedor = cleanText(body.colorProveedor);
    if (!partial || body.unidad !== undefined) data.unidad = cleanText(body.unidad) || 'metros';
    if (!partial || body.ancho !== undefined) data.ancho = positiveNumber(body.ancho, 'Ancho');
    if (!partial || body.activo !== undefined) data.activo = body.activo === true || `${body.activo}` === 'true';
    if (!partial || body.descripcionProveedor !== undefined) data.descripcionProveedor = cleanText(body.descripcionProveedor);
    return data;
  }

  async crearMovimiento(body: any, user?: { id?: number }) {
    const rolloId = optionalInt(body.rolloId);
    if (!rolloId) throw new BadRequestException('Selecciona un rollo');
    const rollo = await this.ensureRollo(rolloId);
    const tipo = `${body.tipo || ''}`.trim().toLowerCase();
    if (!['ingreso', 'salida', 'merma', 'ajuste'].includes(tipo)) {
      throw new BadRequestException('Tipo de movimiento no valido');
    }
    const cantidad = positiveNumber(body.cantidad, 'Cantidad', false);
    let nextDisponible = Number(rollo.cantidadDisponible || 0);
    if (tipo === 'ingreso') nextDisponible += cantidad;
    if (tipo === 'salida' || tipo === 'merma') nextDisponible -= cantidad;
    if (tipo === 'ajuste') nextDisponible = cantidad;
    if (nextDisponible < 0) throw new BadRequestException('La cantidad disponible no puede quedar negativa');

    return this.prisma.$transaction(async (tx) => {
      const movimiento = await tx.movimientoTela.create({
        data: {
          rolloId,
          tipo,
          cantidad,
          fecha: body.fecha ? new Date(`${body.fecha}`) : new Date(),
          referencia: cleanText(body.referencia),
          motivo: cleanText(body.motivo),
          observaciones: cleanText(body.observaciones),
          usuarioId: Number(user?.id || 0) || null,
        },
      });
      const updated = await tx.telaRollo.update({
        where: { id: rolloId },
        data: {
          cantidadDisponible: nextDisponible,
          estado: nextDisponible <= 0 ? 'agotado' : rollo.estado === 'agotado' ? 'disponible' : rollo.estado,
        },
        include: { tela: true, color: true, bodega: true, proveedorRef: true },
      });
      return { movimiento, rollo: updated };
    });
  }

  listarConsumos() {
    return this.prisma.consumoTelaProducto.findMany({
      include: {
        producto: { include: { tela: true, talla: true, color: true } },
        tela: true,
        talla: true,
      },
      orderBy: { id: 'desc' },
    });
  }

  crearConsumo(body: any) {
    const data = this.normalizeConsumo(body);
    return this.prisma.consumoTelaProducto.create({
      data,
      include: { producto: { include: { tela: true, talla: true, color: true } }, tela: true, talla: true },
    });
  }

  async actualizarConsumo(id: number, body: any) {
    await this.ensureConsumo(id);
    const data = this.normalizeConsumo(body, true);
    return this.prisma.consumoTelaProducto.update({
      where: { id },
      data,
      include: { producto: { include: { tela: true, talla: true, color: true } }, tela: true, talla: true },
    });
  }

  async eliminarConsumo(id: number) {
    await this.ensureConsumo(id);
    return this.prisma.consumoTelaProducto.delete({ where: { id } });
  }

  private normalizeConsumo(body: any, partial = false) {
    const data: any = {};
    if (!partial || body.productoId !== undefined) {
      const productoId = optionalInt(body.productoId);
      if (!productoId) throw new BadRequestException('Selecciona el producto');
      data.productoId = productoId;
    }
    if (!partial || body.telaId !== undefined) data.telaId = optionalInt(body.telaId);
    if (!partial || body.tallaId !== undefined) data.tallaId = optionalInt(body.tallaId);
    if (!partial || body.cantidad !== undefined) data.cantidad = positiveNumber(body.cantidad, 'Cantidad', false);
    if (!partial || body.unidad !== undefined) data.unidad = cleanText(body.unidad) || 'metros';
    if (!partial || body.mermaPorcentaje !== undefined) data.mermaPorcentaje = positiveNumber(body.mermaPorcentaje, 'Merma');
    if (!partial || body.observaciones !== undefined) data.observaciones = cleanText(body.observaciones);
    return data;
  }

  private async ensureRollo(id: number) {
    const rollo = await this.prisma.telaRollo.findUnique({ where: { id } });
    if (!rollo) throw new NotFoundException('Rollo no encontrado');
    return rollo;
  }

  private async ensureConsumo(id: number) {
    const consumo = await this.prisma.consumoTelaProducto.findUnique({ where: { id } });
    if (!consumo) throw new NotFoundException('Consumo no encontrado');
    return consumo;
  }

  private async ensureAlias(id: number) {
    const alias = await this.prisma.telaProveedorAlias.findUnique({ where: { id } });
    if (!alias) throw new NotFoundException('Catalogo de tela proveedor no encontrado');
    return alias;
  }
}
