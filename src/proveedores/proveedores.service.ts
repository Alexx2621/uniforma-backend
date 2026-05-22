import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

const cleanText = (value: unknown) => {
  const text = `${value ?? ''}`.trim();
  return text || null;
};

const normalizeNumber = (value: unknown, field: string, integer = false) => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
    throw new BadRequestException(`${field} no valido`);
  }
  return parsed;
};

@Injectable()
export class ProveedoresService {
  constructor(private prisma: PrismaService) {}

  private normalizePayload(body: any, partial = false) {
    const data: any = {};
    if (!partial || body.nombre !== undefined) {
      const nombre = cleanText(body.nombre);
      if (!nombre) throw new BadRequestException('El nombre del proveedor es obligatorio');
      data.nombre = nombre;
    }
    const fields = [
      'razonSocial',
      'nit',
      'contacto',
      'puestoContacto',
      'telefono',
      'telefonoSecundario',
      'correo',
      'sitioWeb',
      'direccion',
      'tipo',
      'banco',
      'numeroCuenta',
      'tipoCuenta',
      'estado',
      'observaciones',
    ];
    for (const field of fields) {
      if (!partial || body[field] !== undefined) data[field] = cleanText(body[field]);
    }
    if (!partial || body.diasCredito !== undefined) data.diasCredito = normalizeNumber(body.diasCredito, 'Dias credito', true);
    if (!partial || body.limiteCredito !== undefined) data.limiteCredito = normalizeNumber(body.limiteCredito, 'Limite credito');
    if (!data.estado && (!partial || body.estado !== undefined)) data.estado = 'activo';
    return data;
  }

  findAll(query: { q?: string; estado?: string; tipo?: string }) {
    const where: any = {};
    const q = cleanText(query.q);
    if (q) {
      where.OR = [
        { nombre: { contains: q } },
        { razonSocial: { contains: q } },
        { nit: { contains: q } },
        { contacto: { contains: q } },
        { telefono: { contains: q } },
        { correo: { contains: q } },
      ];
    }
    if (query.estado) where.estado = query.estado;
    if (query.tipo) where.tipo = query.tipo;
    return this.prisma.proveedor.findMany({
      where,
      include: {
        _count: { select: { ordenes: true, rollosTela: true } },
      },
      orderBy: [{ estado: 'asc' }, { nombre: 'asc' }],
    });
  }

  async findOne(id: number) {
    const proveedor = await this.prisma.proveedor.findUnique({
      where: { id },
      include: {
        rollosTela: { include: { tela: true, color: true, bodega: true } },
        _count: { select: { ordenes: true, rollosTela: true } },
      },
    });
    if (!proveedor) throw new NotFoundException('Proveedor no encontrado');
    return proveedor;
  }

  async create(body: any) {
    const data = this.normalizePayload(body);
    return this.prisma.proveedor.create({ data }).catch((error) => {
      if (error?.code === 'P2002') throw new ConflictException('Ya existe un proveedor con esos datos');
      throw error;
    });
  }

  async update(id: number, body: any) {
    await this.ensureProveedor(id);
    const data = this.normalizePayload(body, true);
    return this.prisma.proveedor.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.ensureProveedor(id);
    const count = await this.prisma.proveedor.findUnique({
      where: { id },
      select: { _count: { select: { ordenes: true, rollosTela: true } } },
    });
    if ((count?._count.ordenes || 0) > 0 || (count?._count.rollosTela || 0) > 0) {
      throw new ConflictException('No se puede eliminar un proveedor con documentos o rollos relacionados');
    }
    return this.prisma.proveedor.delete({ where: { id } });
  }

  private async ensureProveedor(id: number) {
    const proveedor = await this.prisma.proveedor.findUnique({ where: { id } });
    if (!proveedor) throw new NotFoundException('Proveedor no encontrado');
    return proveedor;
  }
}
