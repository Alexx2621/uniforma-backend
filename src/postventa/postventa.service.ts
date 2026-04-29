import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CorrelativosService } from '../correlativos/correlativos.service';
import { PrismaService } from '../prisma.service';

const TIPO_CONFIG: Record<string, { prefijo: string; nombre: string }> = {
  cambio: { prefijo: 'CAM', nombre: 'cambio' },
  devolucion: { prefijo: 'DEV', nombre: 'devolucion' },
};

const ESTADOS = new Set(['pendiente', 'en_revision', 'cerrado', 'anulado']);

@Injectable()
export class PostventaService {
  constructor(
    private prisma: PrismaService,
    private correlativos: CorrelativosService,
  ) {}

  private normalizarTipo(tipo?: string) {
    const value = `${tipo || ''}`.trim().toLowerCase();
    if (!TIPO_CONFIG[value]) {
      throw new BadRequestException('Tipo de postventa no soportado');
    }
    return value;
  }

  private normalizarEstado(estado?: string) {
    const value = `${estado || 'pendiente'}`.trim().toLowerCase();
    if (!ESTADOS.has(value)) {
      throw new BadRequestException('Estado no valido');
    }
    return value;
  }

  private normalizarDetalle(detalle: unknown) {
    if (!Array.isArray(detalle) || !detalle.length) {
      throw new BadRequestException('Agrega al menos un articulo al detalle');
    }
    return detalle.map((item: any) => ({
      codigo: `${item?.codigo || ''}`.trim(),
      producto: `${item?.producto || ''}`.trim(),
      talla: `${item?.talla || ''}`.trim(),
      color: `${item?.color || ''}`.trim(),
      cantidad: Math.max(1, Number(item?.cantidad || 1)),
      precio: Math.max(0, Number(item?.precio || 0)),
      condicion: `${item?.condicion || ''}`.trim(),
      accion: `${item?.accion || ''}`.trim(),
      productoNuevo: `${item?.productoNuevo || ''}`.trim(),
      observaciones: `${item?.observaciones || ''}`.trim(),
    }));
  }

  private buildData(body: any, usuarioId?: number) {
    const tipo = this.normalizarTipo(body?.tipo);
    const clienteNombre = `${body?.clienteNombre || ''}`.trim();
    const motivo = `${body?.motivo || ''}`.trim();
    if (!clienteNombre) {
      throw new BadRequestException('Ingresa el nombre del cliente');
    }
    if (!motivo) {
      throw new BadRequestException('Ingresa el motivo');
    }

    return {
      tipo,
      clienteNombre,
      clienteTelefono: `${body?.clienteTelefono || ''}`.trim() || null,
      documentoReferencia: `${body?.documentoReferencia || ''}`.trim() || null,
      motivo,
      estado: this.normalizarEstado(body?.estado),
      resolucion: `${body?.resolucion || ''}`.trim() || null,
      monto: Math.max(0, Number(body?.monto || 0)),
      observaciones: `${body?.observaciones || ''}`.trim() || null,
      detalle: this.normalizarDetalle(body?.detalle),
      usuarioId: usuarioId || body?.usuarioId || null,
    };
  }

  private assertRegistroAccess(registro: { usuarioId?: number | null }, user?: { id?: number; rol?: string }) {
    if (`${user?.rol || ''}`.toUpperCase() === 'ADMIN') return;
    if (!user?.id || Number(registro.usuarioId) !== Number(user.id)) {
      throw new ForbiddenException('No tienes acceso a este registro');
    }
  }

  listar(
    filtros: { tipo?: string; estado?: string; desde?: string; hasta?: string; usuarioId?: string },
    user?: { id?: number; rol?: string },
  ) {
    const where: any = {};
    if (filtros.tipo) where.tipo = this.normalizarTipo(filtros.tipo);
    if (filtros.estado) where.estado = this.normalizarEstado(filtros.estado);
    if (filtros.desde || filtros.hasta) {
      where.fecha = {};
      if (filtros.desde) where.fecha.gte = new Date(`${filtros.desde}T00:00:00`);
      if (filtros.hasta) where.fecha.lte = new Date(`${filtros.hasta}T23:59:59`);
    }
    if (`${user?.rol || ''}`.toUpperCase() === 'ADMIN') {
      const usuarioId = filtros.usuarioId ? Number(filtros.usuarioId) : null;
      if (usuarioId) where.usuarioId = usuarioId;
    } else {
      if (!user?.id) throw new BadRequestException('No se pudo identificar el usuario');
      where.usuarioId = Number(user.id);
    }

    return this.prisma.cambioDevolucion.findMany({
      where,
      include: { usuario: { select: { id: true, nombre: true, usuario: true, usuarioCorrelativo: true } } },
      orderBy: { fecha: 'desc' },
    });
  }

  async obtener(id: number, user?: { id?: number; rol?: string }) {
    const registro = await this.prisma.cambioDevolucion.findUnique({
      where: { id },
      include: { usuario: { select: { id: true, nombre: true, usuario: true, usuarioCorrelativo: true } } },
    });
    if (!registro) throw new NotFoundException('Registro no encontrado');
    this.assertRegistroAccess(registro, user);
    return registro;
  }

  async crear(body: any, usuarioId?: number) {
    const data = this.buildData(body, usuarioId);
    const folioResp = await this.correlativos.generarUsuarioOperacionCorrelativo(Number(usuarioId), data.tipo);
    return this.prisma.cambioDevolucion.create({
      data: { ...data, folio: folioResp.correlativo },
      include: { usuario: { select: { id: true, nombre: true, usuario: true, usuarioCorrelativo: true } } },
    });
  }

  async actualizar(id: number, body: any, user?: { id?: number; rol?: string }) {
    const actual = await this.obtener(id, user);
    const data = this.buildData(body, actual.usuarioId ?? user?.id);
    return this.prisma.cambioDevolucion.update({
      where: { id },
      data,
      include: { usuario: { select: { id: true, nombre: true, usuario: true, usuarioCorrelativo: true } } },
    });
  }

  async cambiarEstado(id: number, estado: string, user?: { id?: number; rol?: string }) {
    await this.obtener(id, user);
    return this.prisma.cambioDevolucion.update({
      where: { id },
      data: { estado: this.normalizarEstado(estado) },
      include: { usuario: { select: { id: true, nombre: true, usuario: true, usuarioCorrelativo: true } } },
    });
  }
}
