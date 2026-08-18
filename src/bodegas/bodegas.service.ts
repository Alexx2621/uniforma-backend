import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthBodegaUser, BodegaOperacion, getAllowedBodegaIds } from './bodega-access';

@Injectable()
export class BodegasService {
  constructor(private prisma: PrismaService) {}

  private cleanText(value: unknown) {
    const text = `${value ?? ''}`.trim();
    return text || null;
  }

  private normalize(data: any) {
    return {
      nombre: this.cleanText(data.nombre) || '',
      ubicacion: this.cleanText(data.ubicacion),
      tipo: this.cleanText(data.tipo) || 'tienda',
      activa: data.activa === undefined ? true : Boolean(data.activa),
      permiteVentas: data.permiteVentas === undefined ? true : Boolean(data.permiteVentas),
      usaInventarioVentas: Boolean(data.usaInventarioVentas),
      permitePedidos: data.permitePedidos === undefined ? true : Boolean(data.permitePedidos),
      permiteTraslados: data.permiteTraslados === undefined ? true : Boolean(data.permiteTraslados),
      visibleVendedores: Boolean(data.visibleVendedores),
      requiereAutorizacion: Boolean(data.requiereAutorizacion),
      ordenPrioridad: Number.isFinite(Number(data.ordenPrioridad)) ? Number(data.ordenPrioridad) : 100,
      observaciones: this.cleanText(data.observaciones),
    };
  }

  private operationWhere(operacion?: BodegaOperacion | 'solicitud-traslado') {
    if (operacion === 'ventas') return { activa: true, permiteVentas: true };
    if (operacion === 'traslados' || operacion === 'ajustes' || operacion === 'solicitud-traslado') {
      return { activa: true, permiteTraslados: true };
    }
    if (operacion === 'pedidos') return { activa: true, permitePedidos: true };
    if (operacion === 'stock') return { activa: true };
    return {};
  }

  async findAll(query: { operacion?: BodegaOperacion | 'solicitud-traslado'; activas?: string } = {}, user?: AuthBodegaUser) {
    const where: any = { ...this.operationWhere(query.operacion) };
    if (query.activas === 'true') where.activa = true;

    // Para pedir un traslado hace falta ver TODAS las tiendas (a cual sea que
    // se le pida el producto), no solo a las que el usuario ya tiene acceso.
    // La creacion de la solicitud igual valida el acceso del lado propio.
    if (query.operacion !== 'solicitud-traslado') {
      const allowedIds = await getAllowedBodegaIds(this.prisma, user, (query.operacion as BodegaOperacion) || 'stock');
      if (allowedIds !== null) where.id = { in: allowedIds.length ? allowedIds : [-1] };
    }

    return this.prisma.bodega.findMany({
      where,
      include: {
        _count: { select: { inventario: true, usuarios: true, usuariosPermitidos: true, ventas: true } },
      },
      orderBy: [{ ordenPrioridad: 'asc' }, { nombre: 'asc' }],
    });
  }

  create(data: any) {
    const payload = this.normalize(data);
    return this.prisma.bodega.create({ data: payload });
  }

  update(id: number, data: any) {
    const payload = this.normalize(data);
    return this.prisma.bodega.update({
      where: { id },
      data: payload,
    });
  }

  remove(id: number) {
    return this.prisma.bodega.delete({ where: { id } });
  }
}
