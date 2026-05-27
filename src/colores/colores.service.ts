import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

const optionalInt = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new BadRequestException('Identificador no valido');
  return parsed;
};

const cleanText = (value: unknown) => {
  const text = `${value ?? ''}`.trim();
  return text || null;
};

@Injectable()
export class ColoresService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.color.findMany();
  }

  findOne(id: number) {
    return this.prisma.color.findUnique({
      where: { id },
    });
  }

  create(data: any) {
    return this.prisma.color.create({
      data,
    });
  }

  update(id: number, data: any) {
    return this.prisma.color.update({
      where: { id },
      data,
    });
  }

  delete(id: number) {
    return this.prisma.color.delete({
      where: { id },
    });
  }

  listarAliases(query: any = {}) {
    const where: any = {};
    if (query.proveedorId) where.proveedorId = Number(query.proveedorId);
    if (query.colorId) where.colorId = Number(query.colorId);
    if (query.activo !== undefined && query.activo !== '') where.activo = `${query.activo}` === 'true';
    const q = cleanText(query.q);
    if (q) {
      where.OR = [
        { codigoProveedor: { contains: q } },
        { nombreProveedor: { contains: q } },
        { descripcionProveedor: { contains: q } },
        { color: { nombre: { contains: q } } },
        { proveedor: { nombre: { contains: q } } },
        { proveedor: { nit: { contains: q } } },
      ];
    }
    return this.prisma.colorProveedorAlias.findMany({
      where,
      include: { color: true, proveedor: true },
      orderBy: [{ proveedor: { nombre: 'asc' } }, { nombreProveedor: 'asc' }],
    });
  }

  crearAlias(body: any) {
    const data = this.normalizeAlias(body);
    return this.prisma.colorProveedorAlias.create({
      data,
      include: { color: true, proveedor: true },
    });
  }

  async actualizarAlias(id: number, body: any) {
    await this.ensureAlias(id);
    const data = this.normalizeAlias(body, true);
    return this.prisma.colorProveedorAlias.update({
      where: { id },
      data,
      include: { color: true, proveedor: true },
    });
  }

  async eliminarAlias(id: number) {
    await this.ensureAlias(id);
    return this.prisma.colorProveedorAlias.delete({ where: { id } });
  }

  private normalizeAlias(body: any, partial = false) {
    const data: any = {};
    if (!partial || body.proveedorId !== undefined) {
      const proveedorId = optionalInt(body.proveedorId);
      if (!proveedorId) throw new BadRequestException('Selecciona el proveedor');
      data.proveedorId = proveedorId;
    }
    if (!partial || body.colorId !== undefined) {
      const colorId = optionalInt(body.colorId);
      if (!colorId) throw new BadRequestException('Selecciona el color interno');
      data.colorId = colorId;
    }
    if (!partial || body.codigoProveedor !== undefined) data.codigoProveedor = cleanText(body.codigoProveedor);
    if (!partial || body.nombreProveedor !== undefined) {
      const nombreProveedor = cleanText(body.nombreProveedor);
      if (!nombreProveedor) throw new BadRequestException('Ingresa el color del proveedor');
      data.nombreProveedor = nombreProveedor;
    }
    if (!partial || body.descripcionProveedor !== undefined) data.descripcionProveedor = cleanText(body.descripcionProveedor);
    if (!partial || body.activo !== undefined) data.activo = body.activo === true || `${body.activo}` === 'true';
    return data;
  }

  private async ensureAlias(id: number) {
    const alias = await this.prisma.colorProveedorAlias.findUnique({ where: { id } });
    if (!alias) throw new NotFoundException('Equivalencia de color proveedor no encontrada');
    return alias;
  }
}
