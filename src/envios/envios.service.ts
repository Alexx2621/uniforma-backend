import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type AuthUser = { id?: number; rol?: string | null; permisos?: string[] | null; bodegaId?: number | string | null };

const DOCUMENT_TYPES = new Set(['venta', 'pedido', 'pagoPedido', 'pagoVenta']);
const ESTADOS = new Set(['pendiente', 'preparado', 'enviado', 'entregado', 'anulado']);
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const toDateRange = (desde?: string, hasta?: string) => {
  const where: any = {};
  if (desde) {
    const start = DATE_ONLY_RE.test(desde) ? new Date(`${desde}T00:00:00.000Z`) : new Date(desde);
    if (!Number.isNaN(start.getTime())) where.gte = start;
  }
  if (hasta) {
    const end = DATE_ONLY_RE.test(hasta) ? new Date(`${hasta}T23:59:59.999Z`) : new Date(hasta);
    if (!Number.isNaN(end.getTime())) where.lte = end;
  }
  return Object.keys(where).length ? where : undefined;
};

@Injectable()
export class EnviosService {
  constructor(private prisma: PrismaService) {}

  private isAdmin(user?: AuthUser) {
    return `${user?.rol || ''}`.trim().toUpperCase() === 'ADMIN';
  }

  private hasPermission(user: AuthUser | undefined, permission: string) {
    return Array.isArray(user?.permisos) && user.permisos.includes(permission);
  }

  private canManage(user?: AuthUser) {
    return this.isAdmin(user) || this.hasPermission(user, 'envios.manage');
  }

  private canViewAll(user?: AuthUser) {
    return this.isAdmin(user) || this.hasPermission(user, 'sistema.multi-tienda') || this.hasPermission(user, 'envios.manage');
  }

  private ensureUser(user?: AuthUser) {
    const id = Number(user?.id || 0);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('No se pudo identificar el usuario');
    }
    return id;
  }

  private async getCurrentUser(user?: AuthUser) {
    const id = this.ensureUser(user);
    const current = await this.prisma.usuario.findUnique({
      where: { id },
      select: { id: true, bodegaId: true },
    });
    if (!current) throw new BadRequestException('No se pudo identificar el usuario');
    return current;
  }

  private async buildWhere(user?: AuthUser, filters: { desde?: string; hasta?: string; usuarioId?: string; estado?: string } = {}) {
    const current = await this.getCurrentUser(user);
    const where: any = {};
    const fecha = toDateRange(filters.desde, filters.hasta);
    if (fecha) where.fecha = fecha;
    if (filters.estado && ESTADOS.has(filters.estado)) where.estado = filters.estado;

    const requestedUserId = Number(filters.usuarioId || 0);
    if (this.canViewAll(user)) {
      if (Number.isInteger(requestedUserId) && requestedUserId > 0) where.usuarioId = requestedUserId;
      return where;
    }

    where.OR = [
      { usuarioId: current.id },
      ...(current.bodegaId ? [{ bodegaId: current.bodegaId }] : []),
    ];
    return where;
  }

  async findAll(user: AuthUser | undefined, filters: { desde?: string; hasta?: string; usuarioId?: string; estado?: string }) {
    return this.prisma.envio.findMany({
      where: await this.buildWhere(user, filters),
      include: {
        usuario: { select: { id: true, nombre: true, usuario: true } },
        cliente: { select: { id: true, nombre: true, telefono: true } },
        bodega: { select: { id: true, nombre: true } },
        documentos: true,
      },
      orderBy: { fecha: 'desc' },
    });
  }

  async findOne(id: number, user?: AuthUser) {
    const envio = await this.prisma.envio.findFirst({
      where: { id, ...(await this.buildWhere(user)) },
      include: {
        usuario: { select: { id: true, nombre: true, usuario: true } },
        cliente: { select: { id: true, nombre: true, telefono: true } },
        bodega: { select: { id: true, nombre: true } },
        documentos: true,
      },
    });
    if (!envio) throw new NotFoundException('Envio no encontrado');
    return envio;
  }

  private normalizeText(value: unknown) {
    return `${value || ''}`.trim() || null;
  }

  private normalizeDate(value: unknown) {
    if (!value) return new Date();
    const raw = `${value}`.trim();
    const date = DATE_ONLY_RE.test(raw) ? new Date(`${raw}T12:00:00.000Z`) : new Date(raw);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  async create(user: AuthUser | undefined, body: any) {
    if (!this.canManage(user)) throw new ForbiddenException('No tienes permisos para crear envios');
    const current = await this.getCurrentUser(user);
    const documentos = Array.isArray(body?.documentos) ? body.documentos : [];
    if (!documentos.length) throw new BadRequestException('Agrega al menos un documento relacionado');

    const destinatarioNombre = this.normalizeText(body?.destinatarioNombre);
    const direccion = this.normalizeText(body?.direccion);
    const clienteId = Number(body?.clienteId || 0) || null;
    if (!destinatarioNombre) throw new BadRequestException('Ingresa el destinatario');
    if (!direccion) throw new BadRequestException('Ingresa la direccion de entrega');
    const costo = Math.max(0, Number(body?.costo || 0));
    const metodoPagoEnvio = this.normalizeText(body?.metodoPagoEnvio);
    const porcentajeRecargo = ['tarjeta', 'visalink'].includes(`${metodoPagoEnvio || ''}`) ? Math.max(0, Number(body?.porcentajeRecargo || 0)) : 0;
    const recargo = costo * (porcentajeRecargo / 100);

    const docData = documentos.map((doc: any) => {
      const tipo = `${doc?.tipo || ''}`.trim();
      const documentoId = Number(doc?.documentoId || doc?.id || 0);
      if (!DOCUMENT_TYPES.has(tipo) || !Number.isInteger(documentoId) || documentoId <= 0) {
        throw new BadRequestException('Documento relacionado no valido');
      }
      return {
        tipo,
        documentoId,
        referencia: this.normalizeText(doc?.referencia),
        titulo: this.normalizeText(doc?.titulo),
        monto: Number(doc?.monto || 0),
        fecha: doc?.fecha ? new Date(doc.fecha) : null,
      };
    });

    const created = await this.prisma.envio.create({
      data: {
        fecha: this.normalizeDate(body?.fecha),
        estado: 'pendiente',
        destinatarioNombre,
        destinatarioTelefono: this.normalizeText(body?.destinatarioTelefono),
        direccion,
        municipio: this.normalizeText(body?.municipio),
        departamento: this.normalizeText(body?.departamento),
        empresaTransporte: this.normalizeText(body?.empresaTransporte),
        numeroGuia: this.normalizeText(body?.numeroGuia),
        costo,
        recargo,
        porcentajeRecargo,
        metodoPagoEnvio,
        referenciaPagoEnvio: this.normalizeText(body?.referenciaPagoEnvio),
        bancoPagoEnvio: this.normalizeText(body?.bancoPagoEnvio),
        observaciones: this.normalizeText(body?.observaciones),
        usuarioId: current.id,
        bodegaId: Number(body?.bodegaId || current.bodegaId || 0) || null,
        clienteId,
        documentos: { create: docData },
      },
      include: { documentos: true },
    });

    const folio = `ENV-${String(created.id).padStart(5, '0')}`;
    return this.prisma.envio.update({
      where: { id: created.id },
      data: { folio },
      include: {
        usuario: { select: { id: true, nombre: true, usuario: true } },
        cliente: { select: { id: true, nombre: true, telefono: true } },
        bodega: { select: { id: true, nombre: true } },
        documentos: true,
      },
    });
  }

  async updateEstado(id: number, estado?: string, user?: AuthUser) {
    if (!this.canManage(user)) throw new ForbiddenException('No tienes permisos para actualizar envios');
    const value = `${estado || ''}`.trim();
    if (!ESTADOS.has(value)) throw new BadRequestException('Estado no valido');
    await this.findOne(id, user);
    return this.prisma.envio.update({
      where: { id },
      data: { estado: value },
      include: {
        usuario: { select: { id: true, nombre: true, usuario: true } },
        cliente: { select: { id: true, nombre: true, telefono: true } },
        bodega: { select: { id: true, nombre: true } },
        documentos: true,
      },
    });
  }

  async documentosRelacionables(user?: AuthUser, q?: string) {
    const term = `${q || ''}`.trim().toLowerCase();
    const [ventas, pedidos] = await Promise.all([
      this.prisma.venta.findMany({
        include: { cliente: true, pagos: true, bodega: true },
        orderBy: { fecha: 'desc' },
        take: 80,
      }),
      this.prisma.pedidoProduccion.findMany({
        include: { cliente: true, pagos: true, bodega: true, usuario: true },
        orderBy: { fecha: 'desc' },
        take: 80,
      }),
    ]);

    const items: any[] = [];
    ventas.forEach((venta: any) => {
      const cliente = venta.cliente?.nombre || venta.clienteNombre || 'Mostrador';
      const folio = venta.folio || `V-${venta.id}`;
      items.push({
        tipo: 'venta',
        documentoId: venta.id,
        referencia: folio,
        titulo: `${folio} - ${cliente}`,
        monto: Number(venta.total || 0),
        fecha: venta.fecha,
        bodegaId: venta.bodegaId,
      });
      (venta.pagos || []).forEach((pago: any) =>
        items.push({
          tipo: 'pagoVenta',
          documentoId: pago.id,
          referencia: `Pago venta #${pago.id}`,
          titulo: `${folio} - ${cliente}`,
          monto: Number(pago.monto || 0),
          fecha: pago.fecha,
          bodegaId: venta.bodegaId,
        }),
      );
    });

    pedidos.forEach((pedido: any) => {
      const cliente = pedido.cliente?.nombre || pedido.clienteNombre || 'Mostrador';
      const folio = pedido.folio || `P-${pedido.id}`;
      items.push({
        tipo: 'pedido',
        documentoId: pedido.id,
        referencia: folio,
        titulo: `${folio} - ${cliente}`,
        monto: Number(pedido.totalEstimado || 0),
        fecha: pedido.fecha,
        bodegaId: pedido.bodegaId,
      });
      (pedido.pagos || []).forEach((pago: any) =>
        items.push({
          tipo: 'pagoPedido',
          documentoId: pago.id,
          referencia: `Pago pedido #${pago.id}`,
          titulo: `${folio} - ${cliente}`,
          monto: Number(pago.monto || 0) + Number(pago.recargo || 0),
          fecha: pago.fecha,
          bodegaId: pedido.bodegaId,
        }),
      );
    });

    const visibleItems = this.canViewAll(user)
      ? items
      : items.filter((item) => Number(item.bodegaId || 0) === Number(user?.bodegaId || 0));

    if (!term) return visibleItems.slice(0, 120);
    return visibleItems
      .filter((item) => `${item.referencia || ''} ${item.titulo || ''} ${item.tipo || ''}`.toLowerCase().includes(term))
      .slice(0, 120);
  }
}
