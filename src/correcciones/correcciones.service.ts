import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type AuthUser = { id?: number; rol?: string };
type EntidadCorreccionTipo = 'reporteDiario' | 'reporteQuincenal' | 'pagoPedido' | 'pagoVenta';

const TIPOS_DOCUMENTOS_CORREGIBLES = new Set(['reporteDiario', 'reporteQuincenal']);
const TIPOS_CORREGIBLES = new Set<EntidadCorreccionTipo>([
  'reporteDiario',
  'reporteQuincenal',
  'pagoPedido',
  'pagoVenta',
]);

const TIPO_LABEL: Record<EntidadCorreccionTipo, string> = {
  reporteDiario: 'Reporte diario',
  reporteQuincenal: 'Reporte quincenal',
  pagoPedido: 'Pago de pedido',
  pagoVenta: 'Pago de venta',
};

const PAYMENT_FIELDS: Record<string, string> = {
  monto: 'Monto ingresado',
  metodo: 'Metodo de pago',
  referencia: 'Numero de referencia',
  banco: 'Banco',
};

const PAGO_PEDIDO_EXTRA_FIELDS: Record<string, string> = {
  numeroEnvio: 'Numero de envio/guia',
  numeroRecibo: 'Numero de recibo',
  referenciaDocumento: 'Referencia de documento externo',
  observacionesPago: 'Observaciones del pago',
};

@Injectable()
export class CorreccionesService {
  constructor(private prisma: PrismaService) {}

  private ensureUser(user?: AuthUser) {
    const usuarioId = Number(user?.id || 0);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      throw new BadRequestException('No se pudo identificar el usuario');
    }
    return usuarioId;
  }

  private assertManage(user?: AuthUser) {
    if (`${user?.rol || ''}`.trim().toUpperCase() !== 'ADMIN') {
      throw new ForbiddenException('Solo ADMIN puede aplicar correcciones controladas');
    }
  }

  private normalizeTipo(tipo?: string): EntidadCorreccionTipo | undefined {
    const value = `${tipo || ''}`.trim() as EntidadCorreccionTipo;
    if (!value) return undefined;
    if (!TIPOS_CORREGIBLES.has(value)) throw new BadRequestException('Tipo no soportado para correcciones');
    return value;
  }

  private getByPath(data: any, path: string) {
    return path.split('.').reduce((current, part) => (current == null ? undefined : current[part]), data);
  }

  private setByPath(data: any, path: string, value: unknown) {
    const next = JSON.parse(JSON.stringify(data || {}));
    const parts = path.split('.');
    let cursor = next;
    for (const part of parts.slice(0, -1)) {
      if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
        cursor[part] = {};
      }
      cursor = cursor[part];
    }
    cursor[parts[parts.length - 1]] = value;
    return next;
  }

  private normalizeCampoDocumento(documento: any, campo?: string) {
    const value = `${campo || ''}`.trim();
    const data = documento?.data as any;

    if (documento.tipo === 'reporteQuincenal') {
      const day = Number(value.replace(/^ventasPorDia\./, ''));
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        throw new BadRequestException('Selecciona un dia valido para corregir');
      }
      return {
        campo: `ventasPorDia.${day}`,
        etiqueta: `Venta diaria dia ${day}`,
      };
    }

    if (documento.tipo === 'reporteDiario') {
      if (value === 'metaMes' || value === 'promedioDiario') {
        return { campo: value, etiqueta: value === 'metaMes' ? 'Meta mes' : 'Promedio diario' };
      }
      const allowedTopLevel = ['fecha', 'tienda', 'vendedor'];
      if (allowedTopLevel.includes(value) && Object.prototype.hasOwnProperty.call(data || {}, value)) {
        return { campo: value, etiqueta: value };
      }
    }

    throw new BadRequestException('Ese campo no esta habilitado para correccion controlada');
  }

  private normalizeCampoPago(tipo: EntidadCorreccionTipo, campo?: string) {
    const value = `${campo || ''}`.trim();
    const fields = tipo === 'pagoPedido' ? { ...PAYMENT_FIELDS, ...PAGO_PEDIDO_EXTRA_FIELDS } : PAYMENT_FIELDS;
    if (!fields[value]) {
      throw new BadRequestException('Ese campo de pago no esta habilitado para correccion controlada');
    }
    return {
      campo: value,
      etiqueta: fields[value],
      modulo: tipo === 'pagoPedido' ? 'Pagos de pedidos' : 'Pagos de ventas',
    };
  }

  private normalizeValue(value: unknown, campo?: string) {
    if (campo === 'monto') {
      const parsed = Number(`${value ?? ''}`.trim().replace(/,/g, ''));
      if (!Number.isFinite(parsed) || parsed < 0) throw new BadRequestException('Monto no valido');
      return parsed;
    }

    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return '';
      const numeric = Number(trimmed.replace(/,/g, ''));
      return Number.isFinite(numeric) && campo !== 'referencia' && campo !== 'banco' && campo !== 'metodo'
        ? numeric
        : trimmed;
    }
    return value;
  }

  private toPaymentUpdateValue(campo: string, value: unknown) {
    if (campo === 'referencia' || campo === 'banco' || PAGO_PEDIDO_EXTRA_FIELDS[campo]) {
      const text = `${value ?? ''}`.trim();
      return text || null;
    }
    return value;
  }

  private pagoPedidoToTarget(pago: any) {
    const folio = pago?.pedido?.folio || `P-${pago?.pedidoId}`;
    const cliente = pago?.pedido?.cliente?.nombre || pago?.pedido?.clienteNombre || 'Mostrador';
    return {
      id: Number(pago.id),
      tipo: 'pagoPedido',
      correlativo: `Pago #${pago.id}`,
      titulo: `${folio} - ${cliente}`,
      data: {
        monto: Number(pago.monto || 0),
        metodo: pago.metodo || '',
        referencia: pago.referencia || '',
        banco: pago.banco || '',
        numeroEnvio: pago.numeroEnvio || '',
        numeroRecibo: pago.numeroRecibo || '',
        referenciaDocumento: pago.referenciaDocumento || '',
        observacionesPago: pago.observacionesPago || '',
        recargo: Number(pago.recargo || 0),
        porcentajeRecargo: Number(pago.porcentajeRecargo || 0),
        tipo: pago.tipo || '',
        fecha: pago.fecha,
        pedido: {
          id: pago.pedidoId,
          folio,
          clienteNombre: cliente,
          totalEstimado: Number(pago?.pedido?.totalEstimado || 0),
          saldoPendiente: Number(pago?.pedido?.saldoPendiente || 0),
        },
      },
      actualizadoEn: pago.fecha,
      usuario: pago?.pedido?.usuario
        ? {
            id: pago.pedido.usuario.id,
            nombre: pago.pedido.usuario.nombre,
            usuario: pago.pedido.usuario.usuario,
          }
        : null,
      _count: { correcciones: Number(pago._count?.correcciones || 0) },
    };
  }

  private pagoVentaToTarget(pago: any) {
    const folio = pago?.venta?.folio || `V-${pago?.ventaId}`;
    const cliente = pago?.venta?.cliente?.nombre || pago?.venta?.clienteNombre || 'Mostrador';
    return {
      id: Number(pago.id),
      tipo: 'pagoVenta',
      correlativo: `Pago #${pago.id}`,
      titulo: `${folio} - ${cliente}`,
      data: {
        monto: Number(pago.monto || 0),
        metodo: pago.metodo || '',
        referencia: pago.referencia || '',
        banco: pago.banco || '',
        fecha: pago.fecha,
        venta: {
          id: pago.ventaId,
          folio,
          clienteNombre: cliente,
          total: Number(pago?.venta?.total || 0),
        },
      },
      actualizadoEn: pago.fecha,
      usuario: null,
      _count: { correcciones: Number(pago._count?.correcciones || 0) },
    };
  }

  private async countGenericCorrections(tipo: EntidadCorreccionTipo, ids: number[]) {
    if (!ids.length) return new Map<number, number>();
    const rows = await this.prisma.correccionControlada.groupBy({
      by: ['entidadId'],
      where: { entidadTipo: tipo, entidadId: { in: ids } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [Number(row.entidadId), Number(row._count._all || 0)]));
  }

  async buscarDocumentos(filters: { tipo?: string; q?: string; limit?: number }) {
    return this.buscarEntidades(filters);
  }

  async buscarEntidades(filters: { tipo?: string; q?: string; limit?: number }) {
    const tipo = this.normalizeTipo(filters.tipo);
    const q = `${filters.q || ''}`.trim();
    const limit = Math.min(Math.max(Number(filters.limit || 25), 1), 100);

    if (!tipo || TIPOS_DOCUMENTOS_CORREGIBLES.has(tipo)) {
      const where: any = {
        tipo: tipo ? tipo : { in: Array.from(TIPOS_DOCUMENTOS_CORREGIBLES) },
      };
      if (q) {
        where.OR = [{ correlativo: { contains: q } }, { titulo: { contains: q } }];
      }

      if (tipo || !q) {
        return this.prisma.documentoGenerado.findMany({
          where,
          include: {
            usuario: { select: { id: true, nombre: true, usuario: true } },
            _count: { select: { correcciones: true } },
          },
          orderBy: { actualizadoEn: 'desc' },
          take: limit,
        });
      }
    }

    if (tipo === 'pagoPedido') {
      const where: any = q
        ? {
            OR: [
              { referencia: { contains: q } },
              { metodo: { contains: q } },
              { pedido: { folio: { contains: q } } },
              { pedido: { clienteNombre: { contains: q } } },
              { pedido: { cliente: { nombre: { contains: q } } } },
            ],
          }
        : {};
      const pagos = await this.prisma.pagoPedido.findMany({
        where,
        include: {
          pedido: {
            include: {
              cliente: { select: { nombre: true } },
              usuario: { select: { id: true, nombre: true, usuario: true } },
            },
          },
        },
        orderBy: { fecha: 'desc' },
        take: limit,
      });
      const counts = await this.countGenericCorrections('pagoPedido', pagos.map((pago) => Number(pago.id)));
      return pagos.map((pago) => this.pagoPedidoToTarget({ ...pago, _count: { correcciones: counts.get(Number(pago.id)) || 0 } }));
    }

    if (tipo === 'pagoVenta') {
      const where: any = q
        ? {
            OR: [
              { referencia: { contains: q } },
              { metodo: { contains: q } },
              { venta: { folio: { contains: q } } },
              { venta: { clienteNombre: { contains: q } } },
              { venta: { cliente: { nombre: { contains: q } } } },
            ],
          }
        : {};
      const pagos = await this.prisma.pagoVenta.findMany({
        where,
        include: { venta: { include: { cliente: { select: { nombre: true } } } } },
        orderBy: { fecha: 'desc' },
        take: limit,
      });
      const counts = await this.countGenericCorrections('pagoVenta', pagos.map((pago) => Number(pago.id)));
      return pagos.map((pago) => this.pagoVentaToTarget({ ...pago, _count: { correcciones: counts.get(Number(pago.id)) || 0 } }));
    }

    return [];
  }

  async obtenerDocumento(id: number) {
    const documento = await this.prisma.documentoGenerado.findUnique({
      where: { id },
      include: {
        usuario: { select: { id: true, nombre: true, usuario: true } },
        correcciones: {
          include: { usuario: { select: { id: true, nombre: true, usuario: true } } },
          orderBy: { creadoEn: 'desc' },
          take: 25,
        },
      },
    });

    if (!documento || !TIPOS_DOCUMENTOS_CORREGIBLES.has(documento.tipo)) {
      throw new NotFoundException('Documento no encontrado');
    }

    return documento;
  }

  async obtenerEntidad(tipoInput: string, id: number) {
    const tipo = this.normalizeTipo(tipoInput);
    if (!tipo) throw new BadRequestException('Tipo no valido');
    if (TIPOS_DOCUMENTOS_CORREGIBLES.has(tipo)) return this.obtenerDocumento(id);

    if (tipo === 'pagoPedido') {
      const pago = await this.prisma.pagoPedido.findUnique({
        where: { id },
        include: {
          pedido: {
            include: {
              cliente: { select: { nombre: true } },
              usuario: { select: { id: true, nombre: true, usuario: true } },
            },
          },
        },
      });
      if (!pago) throw new NotFoundException('Pago no encontrado');
      const counts = await this.countGenericCorrections('pagoPedido', [id]);
      return this.pagoPedidoToTarget({ ...pago, _count: { correcciones: counts.get(id) || 0 } });
    }

    if (tipo === 'pagoVenta') {
      const pago = await this.prisma.pagoVenta.findUnique({
        where: { id },
        include: { venta: { include: { cliente: { select: { nombre: true } } } } },
      });
      if (!pago) throw new NotFoundException('Pago no encontrado');
      const counts = await this.countGenericCorrections('pagoVenta', [id]);
      return this.pagoVentaToTarget({ ...pago, _count: { correcciones: counts.get(id) || 0 } });
    }

    throw new NotFoundException('Entidad no encontrada');
  }

  async corregirDocumento(
    id: number,
    body: { campo?: string; valorNuevo?: unknown; motivo?: string },
    user?: AuthUser,
  ) {
    const usuarioId = this.ensureUser(user);
    this.assertManage(user);

    const motivo = `${body?.motivo || ''}`.trim();
    if (motivo.length < 8) {
      throw new BadRequestException('Ingresa un motivo de al menos 8 caracteres');
    }

    const documento = await this.prisma.documentoGenerado.findUnique({ where: { id } });
    if (!documento || !TIPOS_DOCUMENTOS_CORREGIBLES.has(documento.tipo)) {
      throw new NotFoundException('Documento no encontrado');
    }

    const { campo, etiqueta } = this.normalizeCampoDocumento(documento, body?.campo);
    const dataAnterior = JSON.parse(JSON.stringify(documento.data || {}));
    const valorAnterior = this.getByPath(dataAnterior, campo);
    const valorNuevo = this.normalizeValue(body?.valorNuevo, campo);
    const dataNueva = this.setByPath(dataAnterior, campo, valorNuevo);

    const [actualizado, correccion] = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.documentoGenerado.update({
        where: { id },
        data: { data: dataNueva as object },
        include: { usuario: { select: { id: true, nombre: true, usuario: true } } },
      });

      const audit = await tx.correccionDocumento.create({
        data: {
          documentoId: id,
          usuarioId,
          tipoDocumento: documento.tipo,
          correlativo: documento.correlativo,
          campo,
          etiqueta,
          valorAnterior: valorAnterior === undefined ? Prisma.JsonNull : (valorAnterior as any),
          valorNuevo: valorNuevo as any,
          motivo,
          dataAnterior: dataAnterior as object,
          dataNueva: dataNueva as object,
        },
        include: { usuario: { select: { id: true, nombre: true, usuario: true } } },
      });

      return [updated, audit] as const;
    });

    return { documento: actualizado, correccion };
  }

  async corregirEntidad(
    tipoInput: string,
    id: number,
    body: { campo?: string; valorNuevo?: unknown; motivo?: string },
    user?: AuthUser,
  ) {
    const tipo = this.normalizeTipo(tipoInput);
    if (!tipo) throw new BadRequestException('Tipo no valido');
    if (TIPOS_DOCUMENTOS_CORREGIBLES.has(tipo)) return this.corregirDocumento(id, body, user);

    const usuarioId = this.ensureUser(user);
    this.assertManage(user);
    const motivo = `${body?.motivo || ''}`.trim();
    if (motivo.length < 8) {
      throw new BadRequestException('Ingresa un motivo de al menos 8 caracteres');
    }

    const { campo, etiqueta, modulo } = this.normalizeCampoPago(tipo, body.campo);
    const valorNuevo = this.normalizeValue(body.valorNuevo, campo);

    if (tipo === 'pagoPedido') {
      const pago = await this.prisma.pagoPedido.findUnique({
        where: { id },
        include: { pedido: { include: { cliente: true, usuario: true, pagos: true } } },
      });
      if (!pago) throw new NotFoundException('Pago no encontrado');

      const targetAnterior = this.pagoPedidoToTarget(pago);
      const dataAnterior = targetAnterior.data;
      const valorAnterior = this.getByPath(dataAnterior, campo);
      const dataNueva = this.setByPath(dataAnterior, campo, valorNuevo);

      const actualizado = await this.prisma.$transaction(async (tx) => {
        await tx.pagoPedido.update({
          where: { id },
          data: { [campo]: this.toPaymentUpdateValue(campo, valorNuevo) } as any,
        });

        const pagos = await tx.pagoPedido.findMany({ where: { pedidoId: pago.pedidoId } });
        const pagado = pagos.reduce((sum, item) => sum + Number(item.monto || 0) + Number(item.recargo || 0), 0);
        const anticipo = pagos
          .filter((item) => `${item.tipo || ''}`.trim().toLowerCase() === 'anticipo')
          .reduce((sum, item) => sum + Number(item.monto || 0) + Number(item.recargo || 0), 0);
        const saldoPendiente = Math.max(0, Number(pago.pedido.totalEstimado || 0) - pagado);

        await tx.pedidoProduccion.update({
          where: { id: pago.pedidoId },
          data: {
            anticipo,
            saldoPendiente,
            ...(saldoPendiente <= 0 && `${pago.pedido.estado || ''}`.trim().toLowerCase() !== 'anulado'
              ? { estado: 'recibido' }
              : {}),
          },
        });

        await tx.correccionControlada.create({
          data: {
            modulo,
            entidadTipo: tipo,
            entidadId: id,
            correlativo: targetAnterior.correlativo,
            titulo: targetAnterior.titulo,
            campo,
            etiqueta,
            valorAnterior: valorAnterior === undefined ? Prisma.JsonNull : (valorAnterior as any),
            valorNuevo: valorNuevo as any,
            motivo,
            dataAnterior: dataAnterior as object,
            dataNueva: dataNueva as object,
            usuarioId,
          },
        });
      });

      return { documento: await this.obtenerEntidad(tipo, id), correccion: actualizado };
    }

    if (tipo === 'pagoVenta') {
      const pago = await this.prisma.pagoVenta.findUnique({
        where: { id },
        include: { venta: { include: { cliente: true, pagos: true } } },
      });
      if (!pago) throw new NotFoundException('Pago no encontrado');

      const targetAnterior = this.pagoVentaToTarget(pago);
      const dataAnterior = targetAnterior.data;
      const valorAnterior = this.getByPath(dataAnterior, campo);
      const dataNueva = this.setByPath(dataAnterior, campo, valorNuevo);

      const actualizado = await this.prisma.$transaction(async (tx) => {
        await tx.pagoVenta.update({
          where: { id },
          data: { [campo]: this.toPaymentUpdateValue(campo, valorNuevo) } as any,
        });

        const pagos = await tx.pagoVenta.findMany({ where: { ventaId: pago.ventaId } });
        const total = pagos.reduce((sum, item) => sum + Number(item.monto || 0), 0);
        await tx.venta.update({ where: { id: pago.ventaId }, data: { total } });

        await tx.correccionControlada.create({
          data: {
            modulo,
            entidadTipo: tipo,
            entidadId: id,
            correlativo: targetAnterior.correlativo,
            titulo: targetAnterior.titulo,
            campo,
            etiqueta,
            valorAnterior: valorAnterior === undefined ? Prisma.JsonNull : (valorAnterior as any),
            valorNuevo: valorNuevo as any,
            motivo,
            dataAnterior: dataAnterior as object,
            dataNueva: dataNueva as object,
            usuarioId,
          },
        });
      });

      return { documento: await this.obtenerEntidad(tipo, id), correccion: actualizado };
    }

    throw new BadRequestException('Tipo no soportado para correcciones');
  }

  async historial(documentoId?: number, tipo?: string, entidadId?: number) {
    const documentos = await this.prisma.correccionDocumento.findMany({
      where: documentoId ? { documentoId } : {},
      include: {
        usuario: { select: { id: true, nombre: true, usuario: true } },
        documento: { select: { id: true, tipo: true, correlativo: true, titulo: true } },
      },
      orderBy: { creadoEn: 'desc' },
      take: 100,
    });

    const entidadTipo = this.normalizeTipo(tipo);
    const genericas = await this.prisma.correccionControlada.findMany({
      where: {
        ...(entidadTipo ? { entidadTipo } : {}),
        ...(entidadId ? { entidadId } : {}),
      },
      include: { usuario: { select: { id: true, nombre: true, usuario: true } } },
      orderBy: { creadoEn: 'desc' },
      take: 100,
    });

    return [
      ...documentos.map((row) => ({
        ...row,
        entidadTipo: row.tipoDocumento,
        entidadId: row.documentoId,
      })),
      ...genericas.map((row) => ({
        ...row,
        documento: {
          id: row.entidadId,
          tipo: row.entidadTipo,
          correlativo: row.correlativo,
          titulo: row.titulo,
        },
      })),
    ]
      .sort((a, b) => new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime())
      .slice(0, 100);
  }
}
