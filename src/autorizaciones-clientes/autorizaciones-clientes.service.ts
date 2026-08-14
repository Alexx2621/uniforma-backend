import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AutorizacionesClientesService {
  constructor(private prisma: PrismaService) {}

  async solicitar(user: any, body: any) {
    const solicitanteId = Number(user?.id || 0);
    const clienteId = Number(body?.clienteId || 0);
    const cliente = await this.prisma.cliente.findUnique({ where: { id: clienteId }, include: { usuario: { select: { id: true, nombre: true, usuario: true } } } });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');
    const propietarioId = Number(cliente.usuarioId || 0);
    if (!propietarioId) throw new BadRequestException('El cliente no tiene vendedor asignado');
    if (propietarioId === solicitanteId) return { estado: 'propio' };
    const vigente = await this.prisma.autorizacionVentaCliente.findFirst({
      where: { clienteId, solicitanteId, ventaId: null, estado: { in: ['pendiente', 'aprobado'] } }, orderBy: { creadoEn: 'desc' },
    });
    if (vigente) return vigente;
    return this.prisma.autorizacionVentaCliente.create({ data: { clienteId, solicitanteId, propietarioId, motivo: `${body?.motivo || 'Venta solicitada por otro vendedor'}`.trim() } });
  }

  listarPendientes(user: any) {
    return this.prisma.autorizacionVentaCliente.findMany({ where: { propietarioId: Number(user?.id || 0), estado: 'pendiente' }, include: { cliente: true, solicitante: { select: { id: true, nombre: true, usuario: true } } }, orderBy: { creadoEn: 'asc' } });
  }

  async resolver(id: number, user: any, aprobar: boolean, body: any) {
    const row = await this.prisma.autorizacionVentaCliente.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Autorizacion no encontrada');
    if (row.propietarioId !== Number(user?.id || 0)) throw new ForbiddenException('Solo el vendedor propietario puede resolverla');
    if (row.estado !== 'pendiente') throw new BadRequestException('La solicitud ya fue resuelta');
    return this.prisma.autorizacionVentaCliente.update({ where: { id }, data: { estado: aprobar ? 'aprobado' : 'rechazado', respuesta: `${body?.comentario || ''}`.trim() || null, resueltoEn: new Date() } });
  }
}
