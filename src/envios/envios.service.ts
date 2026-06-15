import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type AuthUser = { id?: number; rol?: string | null; permisos?: string[] | null; bodegaId?: number | string | null };

const DOCUMENT_TYPES = new Set(['venta', 'pedido', 'pagoPedido', 'pagoVenta']);
const ESTADOS = new Set(['pendiente', 'preparado', 'enviado', 'entregado', 'anulado']);
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MANIFIESTO_ENVIO_OPERACION = 'manifiestoEnvio';
const MANIFIESTO_ENVIO_PREFIJO = 'MCE';

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

  private async buildSimpleWhere(user?: AuthUser, filters: { desde?: string; hasta?: string; usuarioId?: string; estado?: string } = {}) {
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

    where.usuarioId = current.id;
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
        manifiestoDetalles: { select: { manifiestoId: true } },
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
        manifiestoDetalles: { select: { manifiestoId: true } },
      },
    });
    if (!envio) throw new NotFoundException('Envio no encontrado');
    return envio;
  }

  async listarSimples(user: AuthUser | undefined, filters: { desde?: string; hasta?: string; usuarioId?: string; estado?: string }) {
    if (!this.canManage(user)) throw new ForbiddenException('No tienes permisos para ver envios simples');
    return this.prisma.envioSimple.findMany({
      where: await this.buildSimpleWhere(user, filters),
      include: {
        usuario: { select: { id: true, nombre: true, usuario: true } },
        manifiestoDetalles: { select: { manifiestoId: true } },
      },
      orderBy: { fecha: 'desc' },
    });
  }

  async crearSimple(user: AuthUser | undefined, body: any) {
    if (!this.canManage(user)) throw new ForbiddenException('No tienes permisos para crear envios simples');
    const usuarioId = this.ensureUser(user);
    const numeroGuia = this.normalizeText(body?.numeroGuia);
    const destinatarioNombre = this.normalizeText(body?.destinatarioNombre);
    if (!numeroGuia) throw new BadRequestException('Ingresa el numero de guia');
    if (!destinatarioNombre) throw new BadRequestException('Ingresa el destinatario');

    const estado = `${body?.estado || 'pendiente'}`.trim().toLowerCase();
    if (!ESTADOS.has(estado)) throw new BadRequestException('Estado no valido');

    const created = await this.prisma.envioSimple.create({
      data: {
        fecha: this.normalizeDate(body?.fecha),
        numeroGuia,
        destinatarioNombre,
        vendedorNombre: this.normalizeText(body?.vendedorNombre),
        estado,
        observaciones: this.normalizeText(body?.observaciones),
        usuarioId,
      },
    });

    const folio = `ES-${String(created.id).padStart(5, '0')}`;
    return this.prisma.envioSimple.update({
      where: { id: created.id },
      data: { folio },
      include: {
        usuario: { select: { id: true, nombre: true, usuario: true } },
        manifiestoDetalles: { select: { manifiestoId: true } },
      },
    });
  }

  async updateSimpleEstado(id: number, estado?: string, user?: AuthUser) {
    if (!this.canManage(user)) throw new ForbiddenException('No tienes permisos para actualizar envios simples');
    const value = `${estado || ''}`.trim().toLowerCase();
    if (!ESTADOS.has(value)) throw new BadRequestException('Estado no valido');
    const row = await this.prisma.envioSimple.findFirst({
      where: { id, ...(await this.buildSimpleWhere(user)) },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Envio simple no encontrado');
    return this.prisma.envioSimple.update({
      where: { id },
      data: { estado: value },
      include: {
        usuario: { select: { id: true, nombre: true, usuario: true } },
        manifiestoDetalles: { select: { manifiestoId: true } },
      },
    });
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

  private sanitizeCorrelativoCode(value?: string | null) {
    const cleaned = `${value ?? ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);

    return cleaned || 'US';
  }

  private formatUsuarioOperacionCorrelativo(prefijo: string, codigoUsuario: string, numero: number) {
    return `${prefijo}-${codigoUsuario}-${`${numero}`.padStart(4, '0')}`;
  }

  private async generarManifiestoCorrelativo(tx: any, usuarioId: number) {
    const usuario = await tx.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, usuario: true, usuarioCorrelativo: true },
    });
    if (!usuario) throw new BadRequestException('No se pudo identificar el usuario para generar correlativo');

    const codigoUsuario = this.sanitizeCorrelativoCode(usuario.usuarioCorrelativo || usuario.usuario);
    const contador = await tx.usuarioCorrelativoContador.findUnique({
      where: {
        usuarioId_operacion: {
          usuarioId,
          operacion: MANIFIESTO_ENVIO_OPERACION,
        },
      },
    });

    if (!contador) {
      await tx.usuarioCorrelativoContador.create({
        data: {
          usuarioId,
          operacion: MANIFIESTO_ENVIO_OPERACION,
          prefijo: MANIFIESTO_ENVIO_PREFIJO,
          codigoUsuario,
          siguienteNumero: 2,
        },
      });
      return this.formatUsuarioOperacionCorrelativo(MANIFIESTO_ENVIO_PREFIJO, codigoUsuario, 1);
    }

    const numero = Number(contador.siguienteNumero || 1);
    const correlativo = this.formatUsuarioOperacionCorrelativo(contador.prefijo, contador.codigoUsuario, numero);
    await tx.usuarioCorrelativoContador.update({
      where: { id: contador.id },
      data: { siguienteNumero: numero + 1 },
    });
    return correlativo;
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
        manifiestoDetalles: { select: { manifiestoId: true } },
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
        manifiestoDetalles: { select: { manifiestoId: true } },
      },
    });
  }

  private normalizeManifiestoConfig(config: any) {
    const costoPorLinea = Math.max(0, Number(config?.costoPorLinea || 40));
    const saldoActual = Math.max(0, Number(config?.saldoActual || 0));
    return {
      ...config,
      saldoInicial: Math.max(0, Number(config?.saldoInicial || 0)),
      saldoActual,
      costoPorLinea,
      enviosDisponibles: costoPorLinea > 0 ? Math.floor(saldoActual / costoPorLinea) : 0,
    };
  }

  async getManifiestoConfig(user?: AuthUser) {
    if (!this.canManage(user)) throw new ForbiddenException('No tienes permisos para gestionar manifiestos');
    const config = await this.prisma.envioManifiestoConfig.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, saldoInicial: 0, saldoActual: 0, costoPorLinea: 40 },
    });
    return this.normalizeManifiestoConfig(config);
  }

  async updateManifiestoConfig(user: AuthUser | undefined, body: any) {
    if (!this.canManage(user)) throw new ForbiddenException('No tienes permisos para gestionar manifiestos');
    const saldoInicial = Math.max(0, Number(body?.saldoInicial || 0));
    const costoPorLinea = Math.max(0, Number(body?.costoPorLinea || 40));
    const config = await this.prisma.envioManifiestoConfig.upsert({
      where: { id: 1 },
      update: { saldoInicial, saldoActual: saldoInicial, costoPorLinea },
      create: { id: 1, saldoInicial, saldoActual: saldoInicial, costoPorLinea },
    });
    return this.normalizeManifiestoConfig(config);
  }

  async listarManifiestos(user?: AuthUser) {
    if (!this.canViewAll(user) && !this.canManage(user)) throw new ForbiddenException('No tienes permisos para ver manifiestos');
    return this.prisma.envioManifiesto.findMany({
      include: {
        usuario: { select: { id: true, nombre: true, usuario: true } },
        detalles: { orderBy: { orden: 'asc' } },
      },
      orderBy: { fecha: 'desc' },
      take: 120,
    });
  }

  async crearManifiesto(user: AuthUser | undefined, body: any) {
    if (!this.canManage(user)) throw new ForbiddenException('No tienes permisos para crear manifiestos');
    const usuarioId = this.ensureUser(user);
    const envioIds: number[] = Array.from(
      new Set<number>(
        (Array.isArray(body?.envioIds) ? body.envioIds : [])
          .map((id: any) => Number(id))
          .filter((id: number) => Number.isInteger(id) && id > 0),
      ),
    );
    const envioSimpleIds: number[] = Array.from(
      new Set<number>(
        (Array.isArray(body?.envioSimpleIds) ? body.envioSimpleIds : [])
          .map((id: any) => Number(id))
          .filter((id: number) => Number.isInteger(id) && id > 0),
      ),
    );
    if (!envioIds.length && !envioSimpleIds.length) throw new BadRequestException('Selecciona al menos un envio para el manifiesto');

    const where = await this.buildWhere(user);
    const simpleWhere = await this.buildSimpleWhere(user);
    return this.prisma.$transaction(async (tx) => {
      const envios = await tx.envio.findMany({
        where: { AND: [where, { id: { in: envioIds }, estado: { not: 'anulado' } }] },
        include: { usuario: { select: { nombre: true, usuario: true } } },
        orderBy: [{ usuarioId: 'asc' }, { fecha: 'asc' }, { id: 'asc' }],
      });
      const enviosSimples = await tx.envioSimple.findMany({
        where: { AND: [simpleWhere, { id: { in: envioSimpleIds }, estado: { not: 'anulado' } }] },
        include: { usuario: { select: { nombre: true, usuario: true } } },
        orderBy: [{ usuarioId: 'asc' }, { fecha: 'asc' }, { id: 'asc' }],
      });

      if (envios.length !== envioIds.length) {
        throw new BadRequestException('Uno o mas envios no existen, estan anulados o no pertenecen a tu acceso');
      }
      if (enviosSimples.length !== envioSimpleIds.length) {
        throw new BadRequestException('Uno o mas envios simples no existen, estan anulados o no pertenecen a tu acceso');
      }

      const usados = await tx.envioManifiestoDetalle.findMany({
        where: {
          OR: [
            ...(envioIds.length ? [{ envioId: { in: envioIds } }] : []),
            ...(envioSimpleIds.length ? [{ envioSimpleId: { in: envioSimpleIds } }] : []),
          ],
        },
        select: { envioId: true, envioSimpleId: true, numeroGuia: true },
      });
      if (usados.length) {
        const guias = usados.map((item) => item.numeroGuia || (item.envioId ? `ENV-${item.envioId}` : `ES-${item.envioSimpleId}`)).join(', ');
        throw new BadRequestException(`Estos envios ya fueron incluidos en un manifiesto: ${guias}`);
      }

      await tx.envioManifiestoConfig.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1, saldoInicial: 0, saldoActual: 0, costoPorLinea: 40 },
      });
      const config = await tx.envioManifiestoConfig.findUnique({ where: { id: 1 } });
      const costoPorLinea = Math.max(0, Number(config?.costoPorLinea || 40));
      const totalLineas = envios.length + enviosSimples.length;
      const totalConsumido = totalLineas * costoPorLinea;

      if (totalConsumido <= 0) throw new BadRequestException('Configura un costo por linea mayor a cero');

      const saldoUpdate = await tx.envioManifiestoConfig.updateMany({
        where: { id: 1, saldoActual: { gte: totalConsumido } },
        data: { saldoActual: { decrement: totalConsumido } },
      });
      if (saldoUpdate.count !== 1) {
        throw new BadRequestException(`Saldo insuficiente para generar el manifiesto. Necesitas Q ${totalConsumido.toFixed(2)}`);
      }

      const configActualizado = await tx.envioManifiestoConfig.findUnique({ where: { id: 1 } });
      const saldoDespues = Math.max(0, Number(configActualizado?.saldoActual || 0));
      const saldoAntes = saldoDespues + totalConsumido;
      const detalles = [
        ...envios.map((envio) => ({
          tipo: 'envio',
          fecha: envio.fecha,
          envioId: envio.id,
          envioSimpleId: null,
          numeroGuia: this.normalizeText(envio.numeroGuia) || envio.folio || `ENV-${envio.id}`,
          destinatario: envio.destinatarioNombre,
          vendedor: envio.usuario?.nombre || envio.usuario?.usuario || 'N/D',
          estado: envio.estado || 'pendiente',
        })),
        ...enviosSimples.map((envio) => ({
          tipo: 'simple',
          fecha: envio.fecha,
          envioId: null,
          envioSimpleId: envio.id,
          numeroGuia: envio.numeroGuia,
          destinatario: envio.destinatarioNombre,
          vendedor: envio.vendedorNombre || envio.usuario?.nombre || envio.usuario?.usuario || 'N/D',
          estado: envio.estado || 'pendiente',
        })),
      ].sort((a, b) => {
        const vendedorDiff = `${a.vendedor}`.localeCompare(`${b.vendedor}`);
        if (vendedorDiff !== 0) return vendedorDiff;
        return new Date(a.fecha).getTime() - new Date(b.fecha).getTime();
      });

      const folio = await this.generarManifiestoCorrelativo(tx, usuarioId);
      return tx.envioManifiesto.create({
        data: {
          folio,
          fecha: this.normalizeDate(body?.fecha),
          saldoInicial: Math.max(0, Number(configActualizado?.saldoInicial || 0)),
          saldoAntes,
          costoPorLinea,
          totalLineas,
          totalConsumido,
          saldoDespues,
          observaciones: this.normalizeText(body?.observaciones),
          usuarioId,
          detalles: {
            create: detalles.map((envio, index) => ({
              envioId: envio.envioId,
              envioSimpleId: envio.envioSimpleId,
              orden: index + 1,
              numeroGuia: envio.numeroGuia,
              destinatario: envio.destinatario,
              vendedor: envio.vendedor,
              estado: envio.estado,
              costo: costoPorLinea,
            })),
          },
        },
        include: {
          usuario: { select: { id: true, nombre: true, usuario: true } },
          detalles: { orderBy: { orden: 'asc' } },
        },
      });
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
