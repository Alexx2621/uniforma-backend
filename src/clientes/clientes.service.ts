import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ClientesService {
  constructor(private prisma: PrismaService) {}

  private buildLogoValue(logo?: { mimetype: string; buffer: Buffer } | null) {
    if (!logo?.buffer?.length || !logo.mimetype) return null;
    return `data:${logo.mimetype};base64,${logo.buffer.toString('base64')}`;
  }

  private buildPayload(data: any = {}, logoUrl?: string | null) {
    const payload: any = {
      nombre: `${data.nombre || ''}`.trim(),
      telefono: `${data.telefono || ''}`.trim() || null,
      correo: `${data.correo || ''}`.trim() || null,
      direccion: `${data.direccion || ''}`.trim() || null,
      tipoCliente: `${data.tipoCliente || ''}`.trim() || null,
    };

    if (typeof logoUrl !== 'undefined') {
      payload.logoUrl = logoUrl;
    }

    return payload;
  }

  private isAdmin(user?: { rol?: string | null }) {
    return `${user?.rol || ''}`.toUpperCase() === 'ADMIN';
  }

  private clienteInclude() {
    return {
      _count: { select: { ventas: true } },
      usuario: { select: { id: true, nombre: true, usuario: true } },
      ventas: { select: { fecha: true }, orderBy: { fecha: 'asc' as const }, take: 1 },
      pedidos: { select: { fecha: true }, orderBy: { fecha: 'asc' as const }, take: 1 },
    };
  }

  private async buildCarteraWhere(usuarioId: number) {
    const user = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, nombre: true, usuario: true },
    });

    if (!user) return { usuarioId };

    const nombres = [user.usuario, user.nombre].map((value) => `${value || ''}`.trim()).filter(Boolean);
    const historicalMatch = nombres.length
      ? {
          usuarioId: null,
          OR: [
            { ventas: { some: { vendedor: { in: nombres } } } },
            { pedidos: { some: { solicitadoPor: { in: nombres } } } },
          ],
        }
      : null;

    return {
      OR: [{ usuarioId }, ...(historicalMatch ? [historicalMatch] : [])],
    };
  }

  async findAll(user?: { id?: number; rol?: string | null }, usuarioId?: number) {
    const where = this.isAdmin(user)
      ? Number.isInteger(usuarioId) && Number(usuarioId) > 0
        ? await this.buildCarteraWhere(Number(usuarioId))
        : {}
      : await this.buildCarteraWhere(Number(user?.id || 0));

    return this.prisma.cliente.findMany({
      where,
      include: this.clienteInclude(),
      orderBy: { id: 'desc' },
    }).then((clientes) => clientes.map((cliente) => this.withFechaRegistro(cliente)));
  }

  findAllForSelection() {
    return this.prisma.cliente.findMany({
      include: {
        _count: { select: { ventas: true } },
        usuario: { select: { id: true, nombre: true, usuario: true } },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  findOne(id: number) {
    return this.prisma.cliente.findUnique({
      where: { id },
      include: this.clienteInclude(),
    }).then((cliente) => (cliente ? this.withFechaRegistro(cliente) : null));
  }

  private withFechaRegistro(cliente: any) {
    const fechas = [cliente.ventas?.[0]?.fecha, cliente.pedidos?.[0]?.fecha, cliente.creadoEn]
      .filter(Boolean)
      .map((fecha) => new Date(fecha));
    const fechaRegistro = fechas.sort((a, b) => a.getTime() - b.getTime())[0] || cliente.creadoEn;
    const { ventas, pedidos, ...rest } = cliente;
    return { ...rest, fechaRegistro };
  }

  private startOfMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private normalizeKey(value?: string | null) {
    return `${value || ''}`.trim().toUpperCase();
  }

  private addCounter(map: Map<string, { nombre: string; cantidad: number; total: number }>, nombre: string, cantidad: number, total: number) {
    const key = this.normalizeKey(nombre);
    if (!key) return;
    const current = map.get(key) || { nombre, cantidad: 0, total: 0 };
    current.cantidad += Number(cantidad || 0);
    current.total += Number(total || 0);
    map.set(key, current);
  }

  async fichaInteligente(id: number) {
    const cliente = await this.prisma.cliente.findUnique({
      where: { id },
    });

    if (!cliente) return null;

    const [ventas, pedidos, postventa] = await Promise.all([
      this.prisma.venta.findMany({
        where: { clienteId: id },
        include: { detalle: { include: { producto: { include: { talla: true, color: true } } } }, bodega: true },
        orderBy: { fecha: 'desc' },
      }),
      this.prisma.pedidoProduccion.findMany({
        where: { clienteId: id },
        include: { detalle: { include: { producto: { include: { talla: true, color: true } } } }, bodega: true },
        orderBy: { fecha: 'desc' },
      }),
      this.prisma.cambioDevolucion.findMany({
        where: {
          OR: [
            { clienteNombre: cliente.nombre },
            ...(cliente.telefono ? [{ clienteTelefono: cliente.telefono }] : []),
          ],
        },
        orderBy: { fecha: 'desc' },
      }),
    ]);

    const now = new Date();
    const monthStart = this.startOfMonth(now);
    const totalVentas = ventas.reduce((sum, venta) => sum + Number(venta.total || 0), 0);
    const totalPedidos = pedidos.reduce((sum, pedido) => sum + Number(pedido.totalEstimado || 0), 0);
    const totalHistorico = totalVentas + totalPedidos;
    const saldoPendiente = pedidos.reduce((sum, pedido) => sum + Number(pedido.saldoPendiente || 0), 0);
    const comprasMes = ventas
      .filter((venta) => new Date(venta.fecha) >= monthStart)
      .reduce((sum, venta) => sum + Number(venta.total || 0), 0);
    const pedidosMes = pedidos
      .filter((pedido) => new Date(pedido.fecha) >= monthStart)
      .reduce((sum, pedido) => sum + Number(pedido.totalEstimado || 0), 0);

    const productoMap = new Map<string, { nombre: string; cantidad: number; total: number }>();
    const tallaMap = new Map<string, { nombre: string; cantidad: number; total: number }>();
    const colorMap = new Map<string, { nombre: string; cantidad: number; total: number }>();

    ventas.forEach((venta) => {
      venta.detalle.forEach((detalle) => {
        const producto = detalle.producto;
        const cantidad = Number(detalle.cantidad || 0);
        this.addCounter(productoMap, producto?.nombre || detalle.descripcion || 'Producto', cantidad, Number(detalle.subtotal || 0));
        this.addCounter(tallaMap, producto?.talla?.nombre || '', cantidad, 0);
        this.addCounter(colorMap, producto?.color?.nombre || '', cantidad, 0);
      });
    });

    pedidos.forEach((pedido) => {
      pedido.detalle.forEach((detalle) => {
        const producto = detalle.producto;
        const cantidad = Number(detalle.cantidad || 0);
        const total = Number(detalle.precioUnit || 0) * cantidad + Number(detalle.bordado || 0) - Number(detalle.descuento || 0);
        this.addCounter(productoMap, producto?.nombre || detalle.descripcion || 'Producto', cantidad, total);
        this.addCounter(tallaMap, producto?.talla?.nombre || '', cantidad, 0);
        this.addCounter(colorMap, producto?.color?.nombre || '', cantidad, 0);
      });
    });

    const top = (map: Map<string, { nombre: string; cantidad: number; total: number }>, limit = 5) =>
      Array.from(map.values())
        .sort((a, b) => b.cantidad - a.cantidad || b.total - a.total)
        .slice(0, limit);

    const actividad = [
      ...ventas.slice(0, 8).map((venta) => ({
        tipo: 'venta',
        id: venta.id,
        folio: venta.folio || `V-${venta.id}`,
        fecha: venta.fecha,
        estado: 'completada',
        total: venta.total,
        bodega: venta.bodega?.nombre || null,
      })),
      ...pedidos.slice(0, 8).map((pedido) => ({
        tipo: 'pedido',
        id: pedido.id,
        folio: pedido.folio || `P-${pedido.id}`,
        fecha: pedido.fecha,
        estado: pedido.estado,
        total: pedido.totalEstimado,
        saldoPendiente: pedido.saldoPendiente,
        bodega: pedido.bodega?.nombre || null,
      })),
      ...postventa.slice(0, 5).map((row) => ({
        tipo: row.tipo,
        id: row.id,
        folio: row.folio,
        fecha: row.fecha,
        estado: row.estado,
        total: row.monto,
      })),
    ]
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .slice(0, 12);

    const ultimaFecha = actividad[0]?.fecha ? new Date(actividad[0].fecha) : null;
    const diasSinCompra = ultimaFecha ? Math.max(0, Math.floor((now.getTime() - ultimaFecha.getTime()) / 86400000)) : null;
    const oportunidades = [
      saldoPendiente > 0 ? `Tiene saldo pendiente de Q ${saldoPendiente.toFixed(2)}.` : null,
      diasSinCompra !== null && diasSinCompra >= 45 ? `Han pasado ${diasSinCompra} dias desde su ultima actividad.` : null,
      postventa.length > 0 ? `Tiene ${postventa.length} registro(s) de postventa.` : null,
      top(productoMap, 1)[0]?.nombre ? `Producto favorito: ${top(productoMap, 1)[0].nombre}.` : null,
    ].filter(Boolean);

    return {
      cliente,
      resumen: {
        totalHistorico,
        totalVentas,
        totalPedidos,
        saldoPendiente,
        comprasMes: comprasMes + pedidosMes,
        ventasCantidad: ventas.length,
        pedidosCantidad: pedidos.length,
        postventaCantidad: postventa.length,
        ticketPromedio: ventas.length + pedidos.length ? totalHistorico / (ventas.length + pedidos.length) : 0,
        diasSinCompra,
        ultimaActividad: ultimaFecha,
      },
      preferencias: {
        productos: top(productoMap),
        tallas: top(tallaMap, 4),
        colores: top(colorMap, 4),
      },
      actividad,
      oportunidades,
    };
  }

  create(data: any, logo?: { mimetype: string; buffer: Buffer } | null, usuarioId?: number) {
    return this.prisma.cliente.create({
      data: {
        ...this.buildPayload(data, this.buildLogoValue(logo)),
        usuarioId: Number(usuarioId || 0) || null,
      },
      include: { _count: { select: { ventas: true } } },
    });
  }

  update(id: number, data: any, logo?: { mimetype: string; buffer: Buffer } | null) {
    return this.prisma.cliente.update({
      where: { id },
      data: this.buildPayload(data, typeof logo === 'undefined' ? undefined : this.buildLogoValue(logo)),
      include: { _count: { select: { ventas: true } } },
    });
  }

  asignarCartera(id: number, usuarioId?: number | null) {
    return this.prisma.cliente.update({
      where: { id },
      data: {
        usuarioId: Number(usuarioId || 0) || null,
      },
      include: this.clienteInclude(),
    }).then((cliente) => this.withFechaRegistro(cliente));
  }

  delete(id: number) {
    return this.prisma.cliente.delete({
      where: { id },
    });
  }
}
