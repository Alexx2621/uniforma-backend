import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { assertBodegaAccess } from '../bodegas/bodega-access';
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

  private normalizarLinea(item: any, operacion: 'devuelto' | 'entregado') {
    const productoId = Number(item?.productoId || 0);
    const bodegaId = Number(item?.bodegaId || 0);
    const cantidad = Math.max(1, Number(item?.cantidad || 1));
    return {
      productoId: productoId || null,
      bodegaId: bodegaId || null,
      bodegaNombre: `${item?.bodegaNombre || ''}`.trim(),
      codigo: `${item?.codigo || ''}`.trim(),
      producto: `${item?.producto || ''}`.trim(),
      tipoProducto: `${item?.tipoProducto || ''}`.trim(),
      genero: `${item?.genero || ''}`.trim(),
      tela: `${item?.tela || ''}`.trim(),
      talla: `${item?.talla || ''}`.trim(),
      color: `${item?.color || ''}`.trim(),
      cantidad,
      precio: Math.max(0, Number(item?.precio || 0)),
      condicion: `${item?.condicion || (operacion === 'devuelto' ? 'vendible' : '')}`.trim(),
      accionInventario: `${item?.accionInventario || 'aplicar'}`.trim(),
      observaciones: `${item?.observaciones || ''}`.trim(),
      operacion,
    };
  }

  private normalizarDetalle(detalle: unknown, tipo: string) {
    if (!detalle) {
      throw new BadRequestException('Agrega al menos un articulo al detalle');
    }

    if (Array.isArray(detalle)) {
      if (!detalle.length) throw new BadRequestException('Agrega al menos un articulo al detalle');
      const devueltos = detalle.map((item: any) => this.normalizarLinea(item, 'devuelto'));
      return {
        version: 2,
        modo: 'simple',
        devueltos,
        entregados: [],
        pago: null,
      };
    }

    const raw = detalle as any;
    const devueltos = Array.isArray(raw.devueltos) ? raw.devueltos.map((item: any) => this.normalizarLinea(item, 'devuelto')) : [];
    const entregados = Array.isArray(raw.entregados) ? raw.entregados.map((item: any) => this.normalizarLinea(item, 'entregado')) : [];
    if (!devueltos.length && !entregados.length) {
      throw new BadRequestException('Agrega al menos un articulo al detalle');
    }
    if (tipo === 'cambio' && (!devueltos.length || !entregados.length)) {
      throw new BadRequestException('Un cambio debe tener productos devueltos y productos entregados');
    }

    const pago = raw.pago
      ? {
          metodo: `${raw.pago?.metodo || ''}`.trim(),
          referencia: `${raw.pago?.referencia || ''}`.trim(),
          banco: `${raw.pago?.banco || ''}`.trim(),
          ubicacion: `${raw.pago?.ubicacion || ''}`.trim(),
          montoPagado: Math.max(0, Number(raw.pago?.montoPagado || 0)),
          observaciones: `${raw.pago?.observaciones || ''}`.trim(),
        }
      : null;

    return {
      version: 2,
      modo: raw.modo || 'inventario',
      devueltos,
      entregados,
      pago,
    };
  }

  private totalLineas(lineas: any[] = []) {
    return lineas.reduce((sum, item) => sum + Number(item.precio || 0) * Number(item.cantidad || 0), 0);
  }

  private calcularMonto(tipo: string, detalle: any) {
    const totalDevuelto = this.totalLineas(detalle?.devueltos || []);
    const totalEntregado = this.totalLineas(detalle?.entregados || []);
    if (tipo === 'cambio') return totalEntregado - totalDevuelto;
    return totalDevuelto;
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

    const detalle = this.normalizarDetalle(body?.detalle, tipo);

    return {
      tipo,
      clienteNombre,
      clienteTelefono: `${body?.clienteTelefono || ''}`.trim() || null,
      documentoReferencia: `${body?.documentoReferencia || ''}`.trim() || null,
      motivo,
      estado: this.normalizarEstado(body?.estado),
      resolucion: `${body?.resolucion || ''}`.trim() || null,
      monto: this.calcularMonto(tipo, detalle),
      observaciones: `${body?.observaciones || ''}`.trim() || null,
      detalle,
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
    user?: { id?: number; rol?: string; permisos?: string[] | null },
  ) {
    const where: any = {};
    if (filtros.tipo) where.tipo = this.normalizarTipo(filtros.tipo);
    if (filtros.estado) where.estado = this.normalizarEstado(filtros.estado);
    if (filtros.desde || filtros.hasta) {
      where.fecha = {};
      if (filtros.desde) where.fecha.gte = new Date(`${filtros.desde}T00:00:00`);
      if (filtros.hasta) where.fecha.lte = new Date(`${filtros.hasta}T23:59:59`);
    }
    const permisos = user?.permisos || [];
    const canFilterUsuarios =
      `${user?.rol || ''}`.toUpperCase() === 'ADMIN' ||
      permisos.includes('dashboard.filtro-vendedor') ||
      permisos.includes('dashboard.ver-todo') ||
      permisos.includes('sistema.selector-vendedores');
    if (canFilterUsuarios) {
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
    if (data.estado === 'cerrado') {
      throw new BadRequestException('Guarda el registro y usa la accion cerrar para aplicar inventario');
    }
    const folioResp = await this.correlativos.generarUsuarioOperacionCorrelativo(Number(usuarioId), data.tipo);
    return this.prisma.cambioDevolucion.create({
      data: { ...data, folio: folioResp.correlativo },
      include: { usuario: { select: { id: true, nombre: true, usuario: true, usuarioCorrelativo: true } } },
    });
  }

  async actualizar(id: number, body: any, user?: { id?: number; rol?: string }) {
    const actual = await this.obtener(id, user);
    if (actual.estado === 'cerrado') {
      throw new BadRequestException('No se puede editar un registro cerrado');
    }
    const data = this.buildData(body, actual.usuarioId ?? user?.id);
    if (data.estado === 'cerrado') {
      throw new BadRequestException('Usa la accion cerrar para aplicar inventario');
    }
    return this.prisma.cambioDevolucion.update({
      where: { id },
      data,
      include: { usuario: { select: { id: true, nombre: true, usuario: true, usuarioCorrelativo: true } } },
    });
  }

  private lineasPorOperacion(detalle: any, operacion: 'devuelto' | 'entregado') {
    if (Array.isArray(detalle)) {
      return operacion === 'devuelto' ? detalle : [];
    }
    return Array.isArray(detalle?.[operacion === 'devuelto' ? 'devueltos' : 'entregados'])
      ? detalle[operacion === 'devuelto' ? 'devueltos' : 'entregados']
      : [];
  }

  private async aplicarEntrada(tx: any, registro: any, item: any, user?: { id?: number; rol?: string; permisos?: string[] | null; bodegaId?: number | string | null }) {
    const productoId = Number(item.productoId || 0);
    const bodegaId = Number(item.bodegaId || 0);
    const cantidad = Math.max(1, Number(item.cantidad || 0));
    if (!productoId || !bodegaId) {
      throw new BadRequestException(`El producto devuelto ${item.codigo || ''} debe tener producto y bodega de ingreso`);
    }
    if (`${item.accionInventario || 'aplicar'}` === 'no_ingresar') return;
    await assertBodegaAccess(this.prisma, user, bodegaId, 'ajustes');
    await tx.inventario.upsert({
      where: { bodegaId_productoId: { bodegaId, productoId } },
      update: { stock: { increment: cantidad } },
      create: { bodegaId, productoId, stock: cantidad },
    });
    await tx.movInventario.create({
      data: {
        bodegaId,
        productoId,
        tipo: registro.tipo === 'devolucion' ? 'devolucion_entrada' : 'cambio_entrada',
        cantidad,
        referencia: registro.folio,
      },
    });
  }

  private async aplicarSalida(tx: any, registro: any, item: any, user?: { id?: number; rol?: string; permisos?: string[] | null; bodegaId?: number | string | null }) {
    const productoId = Number(item.productoId || 0);
    const bodegaId = Number(item.bodegaId || 0);
    const cantidad = Math.max(1, Number(item.cantidad || 0));
    if (!productoId || !bodegaId) {
      throw new BadRequestException(`El producto entregado ${item.codigo || ''} debe tener producto y bodega de salida`);
    }
    await assertBodegaAccess(this.prisma, user, bodegaId, 'ventas');
    const result = await tx.inventario.updateMany({
      where: { bodegaId, productoId, stock: { gte: cantidad } },
      data: { stock: { decrement: cantidad } },
    });
    if (result.count !== 1) {
      const inv = await tx.inventario.findUnique({
        where: { bodegaId_productoId: { bodegaId, productoId } },
        select: { stock: true },
      });
      throw new BadRequestException(
        `Stock insuficiente para ${item.codigo || 'producto entregado'}. Disponible: ${Number(inv?.stock || 0)}. Solicitado: ${cantidad}.`,
      );
    }
    await tx.movInventario.create({
      data: {
        bodegaId,
        productoId,
        tipo: 'cambio_salida',
        cantidad,
        referencia: registro.folio,
      },
    });
  }

  private validarPagoDiferencia(registro: any) {
    const diferencia = Number(registro.monto || 0);
    if (registro.tipo !== 'cambio' || diferencia <= 0) return;
    const pago = (registro.detalle as any)?.pago || {};
    const pagado = Number(pago.montoPagado || 0);
    if (pagado < diferencia) {
      throw new BadRequestException(`La diferencia a pagar es Q ${diferencia.toFixed(2)}. Registra el pago completo antes de cerrar.`);
    }
    if (!`${pago.metodo || ''}`.trim()) {
      throw new BadRequestException('Selecciona el metodo de pago de la diferencia');
    }
  }

  private async cerrarRegistro(id: number, user?: { id?: number; rol?: string; permisos?: string[] | null; bodegaId?: number | string | null }) {
    return this.prisma.$transaction(async (tx) => {
      const registro = await tx.cambioDevolucion.findUnique({ where: { id } });
      if (!registro) throw new NotFoundException('Registro no encontrado');
      this.assertRegistroAccess(registro, user);
      if (registro.estado === 'anulado') throw new BadRequestException('No se puede cerrar un registro anulado');
      if (registro.estado === 'cerrado') return registro;

      this.validarPagoDiferencia(registro);
      for (const item of this.lineasPorOperacion(registro.detalle, 'devuelto')) {
        await this.aplicarEntrada(tx, registro, item, user);
      }
      for (const item of this.lineasPorOperacion(registro.detalle, 'entregado')) {
        await this.aplicarSalida(tx, registro, item, user);
      }

      return tx.cambioDevolucion.update({
        where: { id },
        data: { estado: 'cerrado' },
        include: { usuario: { select: { id: true, nombre: true, usuario: true, usuarioCorrelativo: true } } },
      });
    });
  }

  async cambiarEstado(id: number, estado: string, user?: { id?: number; rol?: string; permisos?: string[] | null; bodegaId?: number | string | null }) {
    if (this.normalizarEstado(estado) === 'cerrado') {
      return this.cerrarRegistro(id, user);
    }
    const actual = await this.obtener(id, user);
    if (actual.estado === 'cerrado') {
      throw new BadRequestException('Un registro cerrado no se puede cambiar de estado desde este modulo');
    }
    return this.prisma.cambioDevolucion.update({
      where: { id },
      data: { estado: this.normalizarEstado(estado) },
      include: { usuario: { select: { id: true, nombre: true, usuario: true, usuarioCorrelativo: true } } },
    });
  }
}
