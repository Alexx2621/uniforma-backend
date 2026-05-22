import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

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
    if (this.isAdmin(user) || this.hasPermission(user, 'sistema.multi-tienda')) return {};
    const currentUser = await this.prisma.usuario.findUnique({
      where: { id: Number(user?.id || 0) },
      select: { bodegaId: true },
    });
    if (!currentUser?.bodegaId) return { bodegaId: -1 };
    return { OR: [{ bodegaId: currentUser.bodegaId }, { bodegaId: null }] };
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
    if (!partial || body.bodegaId !== undefined) data.bodegaId = optionalInt(body.bodegaId);
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
}
