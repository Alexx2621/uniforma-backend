import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type RelationNode = {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  label?: string;
  amount?: number;
  date?: Date | string | null;
  sourceId: number;
  path?: string;
  isRoot?: boolean;
};

type RelationEdge = {
  from: string;
  to: string;
  label?: string;
};

const DOC_TYPES = new Set(['pedido', 'venta', 'pagoPedido', 'pagoVenta', 'envio', 'traslado', 'ingreso', 'solicitudTraslado', 'conteo']);

@Injectable()
export class RelacionesService {
  constructor(private prisma: PrismaService) {}

  async find(tipo: string, id: number) {
    const normalized = `${tipo || ''}`.trim();
    if (!DOC_TYPES.has(normalized) || !Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('Documento no valido para mapa de relaciones');
    }

    if (normalized === 'pedido') return this.buildPedido(id);
    if (normalized === 'venta') return this.buildVenta(id);
    if (normalized === 'pagoPedido') return this.buildPagoPedido(id);
    if (normalized === 'pagoVenta') return this.buildPagoVenta(id);
    if (normalized === 'envio') return this.buildEnvio(id);
    if (normalized === 'traslado') return this.buildTraslado(id);
    if (normalized === 'ingreso') return this.buildIngreso(id);
    if (normalized === 'solicitudTraslado') return this.buildSolicitudTraslado(id);
    return this.buildConteo(id);
  }

  private createGraph() {
    const nodes = new Map<string, RelationNode>();
    const edges = new Map<string, RelationEdge>();

    const addNode = (node: RelationNode) => {
      const current = nodes.get(node.id);
      nodes.set(node.id, current ? { ...current, ...node, isRoot: current.isRoot || node.isRoot } : node);
    };

    const addEdge = (from: string, to: string, label?: string) => {
      if (!from || !to || from === to) return;
      edges.set(`${from}->${to}:${label || ''}`, { from, to, label });
    };

    return {
      nodes,
      edges,
      addNode,
      addEdge,
      result: () => ({ nodes: Array.from(nodes.values()), edges: Array.from(edges.values()) }),
    };
  }

  private money(value: unknown) {
    return Number(value || 0);
  }

  private pedidoNode(pedido: any, isRoot = false): RelationNode {
    const pedidoId = Number(pedido?.id || pedido?.documentoId || 0);
    const cliente = pedido?.cliente?.nombre || pedido?.clienteNombre || 'Mostrador';
    return {
      id: `pedido-${pedidoId}`,
      type: 'pedido',
      title: pedido?.folio || pedido?.referencia || `P-${pedidoId}`,
      subtitle: `Cliente: ${cliente}`,
      amount: this.money(pedido?.totalEstimado ?? pedido?.monto),
      date: pedido?.fecha,
      sourceId: pedidoId,
      path: pedidoId ? `/produccion/${pedidoId}` : '/produccion',
      isRoot,
    };
  }

  private ventaNode(venta: any, isRoot = false): RelationNode {
    const ventaId = Number(venta?.id || venta?.documentoId || 0);
    const cliente = venta?.cliente?.nombre || venta?.clienteNombre || 'CF';
    return {
      id: `venta-${ventaId}`,
      type: 'venta',
      title: venta?.folio || venta?.referencia || `V-${ventaId}`,
      subtitle: `Cliente: ${cliente}`,
      amount: this.money(venta?.total ?? venta?.monto),
      date: venta?.fecha,
      sourceId: ventaId,
      path: '/ventas',
      isRoot,
    };
  }

  private pagoPedidoNode(pago: any, pedidoId?: number, isRoot = false): RelationNode {
    const pagoId = Number(pago?.id || pago?.documentoId || 0);
    return {
      id: `pagoPedido-${pagoId}`,
      type: 'pago',
      title: pago?.referencia || `Pago pedido #${pagoId}`,
      subtitle: [pago?.metodo, pago?.tipo].filter(Boolean).join(' | ') || 'Pago de pedido',
      amount: this.money(pago?.monto) + this.money(pago?.recargo),
      date: pago?.fecha,
      sourceId: pagoId,
      path: pedidoId ? `/pagos/recibidos?pedido=${pedidoId}` : '/pagos/recibidos',
      isRoot,
    };
  }

  private pagoVentaNode(pago: any, isRoot = false): RelationNode {
    const pagoId = Number(pago?.id || pago?.documentoId || 0);
    return {
      id: `pagoVenta-${pagoId}`,
      type: 'pago',
      title: pago?.referencia || `Pago venta #${pagoId}`,
      subtitle: pago?.metodo || 'Pago de venta',
      amount: this.money(pago?.monto),
      date: pago?.fecha,
      sourceId: pagoId,
      path: '/ventas',
      isRoot,
    };
  }

  private envioNode(envio: any, isRoot = false): RelationNode {
    const envioId = Number(envio?.id || envio?.envioId || 0);
    return {
      id: `envio-${envioId}`,
      type: 'envio',
      title: envio?.folio || `ENV-${envioId}`,
      subtitle: [envio?.estado, envio?.destinatarioNombre, envio?.numeroGuia].filter(Boolean).join(' | '),
      amount: this.money(envio?.costo) + this.money(envio?.recargo),
      date: envio?.fecha,
      sourceId: envioId,
      path: '/envios',
      isRoot,
    };
  }

  private trasladoNode(traslado: any, isRoot = false): RelationNode {
    const trasladoId = Number(traslado?.id || 0);
    return {
      id: `traslado-${trasladoId}`,
      type: 'traslado',
      title: traslado?.folio || `Traslado #${trasladoId}`,
      subtitle: [traslado?.estado, traslado?.desdeBodega?.nombre, traslado?.haciaBodega?.nombre].filter(Boolean).join(' | '),
      date: traslado?.fecha,
      sourceId: trasladoId,
      path: '/inventario/traslados',
      isRoot,
    };
  }

  private ingresoNode(ingreso: any, isRoot = false): RelationNode {
    const ingresoId = Number(ingreso?.id || 0);
    return {
      id: `ingreso-${ingresoId}`,
      type: 'ingreso',
      title: ingreso?.folio || `Ingreso #${ingresoId}`,
      subtitle: ingreso?.bodega?.nombre || 'Ingreso de inventario',
      date: ingreso?.fecha,
      sourceId: ingresoId,
      path: '/inventario',
      isRoot,
    };
  }

  private solicitudTrasladoNode(solicitud: any, isRoot = false): RelationNode {
    const solicitudId = Number(solicitud?.id || 0);
    return {
      id: `solicitudTraslado-${solicitudId}`,
      type: 'solicitudTraslado',
      title: solicitud?.folio || `Solicitud traslado #${solicitudId}`,
      subtitle: [solicitud?.estado, solicitud?.desdeBodega?.nombre, solicitud?.haciaBodega?.nombre].filter(Boolean).join(' | '),
      date: solicitud?.fecha,
      sourceId: solicitudId,
      path: '/inventario/traslados',
      isRoot,
    };
  }

  private conteoNode(conteo: any, isRoot = false): RelationNode {
    const conteoId = Number(conteo?.id || 0);
    return {
      id: `conteo-${conteoId}`,
      type: 'conteo',
      title: conteo?.folio || `Conteo #${conteoId}`,
      subtitle: conteo?.bodega?.nombre || 'Conteo fisico',
      date: conteo?.fecha,
      sourceId: conteoId,
      path: '/inventario/conteos',
      isRoot,
    };
  }

  private unificacionNode(unificado: any): RelationNode {
    const id = Number(unificado?.id || unificado?.produccionUnificadoId || 0);
    return {
      id: `unificacion-${id}`,
      type: 'unificacion',
      title: unificado?.correlativo || `Unificacion #${id}`,
      subtitle: unificado?.nombre || 'Produccion unificada',
      date: unificado?.creadoEn,
      sourceId: id,
      path: '/reportes/produccion-unificados',
    };
  }

  private postventaNode(postventa: any, isRoot = false): RelationNode {
    const id = Number(postventa?.id || postventa?.postventaId || 0);
    const tipo = `${postventa?.tipo || ''}`.trim().toLowerCase();
    return {
      id: `postventa-${id}`,
      type: 'postventa',
      title: postventa?.folio || `${tipo === 'devolucion' ? 'Devolucion' : 'Cambio'} #${id}`,
      subtitle: [postventa?.motivo, postventa?.estado].filter(Boolean).join(' | '),
      amount: postventa?.monto != null ? this.money(postventa.monto) : undefined,
      date: postventa?.fecha,
      sourceId: id,
      path: tipo === 'devolucion' ? '/devoluciones' : '/cambios',
      isRoot,
    };
  }

  private avanceNode(avance: any, pedidoId: number): RelationNode {
    const avanceId = Number(avance?.id || 0);
    return {
      id: `avance-${avanceId}`,
      type: 'avance',
      title: `Avance #${avanceId}`,
      subtitle: [avance?.fase, avance?.responsable].filter(Boolean).join(' | ') || 'Avance de produccion',
      amount: this.money(avance?.cantidad),
      date: avance?.fecha,
      sourceId: avanceId,
      path: `/produccion/${pedidoId}`,
    };
  }

  private nodeFromEnvioDocumento(doc: any): RelationNode {
    const id = Number(doc?.documentoId || 0);
    if (doc?.tipo === 'pedido') return this.pedidoNode(doc);
    if (doc?.tipo === 'venta') return this.ventaNode(doc);
    if (doc?.tipo === 'pagoPedido') return this.pagoPedidoNode(doc);
    if (doc?.tipo === 'pagoVenta') return this.pagoVentaNode(doc);
    return {
      id: `${doc?.tipo}-${id}`,
      type: `${doc?.tipo || 'documento'}`,
      title: doc?.referencia || `${doc?.tipo || 'Documento'} #${id}`,
      subtitle: doc?.titulo || undefined,
      amount: this.money(doc?.monto),
      date: doc?.fecha,
      sourceId: id,
    };
  }

  private async addEnvioLinks(graph: ReturnType<RelacionesService['createGraph']>, seeds: Array<{ tipo: string; id: number; nodeId: string }>) {
    const filters = seeds
      .filter((seed) => seed.tipo !== 'envio' && Number(seed.id) > 0)
      .map((seed) => ({ tipo: seed.tipo, documentoId: seed.id }));
    if (!filters.length) return;

    const docs = await this.prisma.envioDocumento.findMany({
      where: { OR: filters },
      include: { envio: { include: { documentos: true } } },
    });

    docs.forEach((doc: any) => {
      if (!doc?.envio) return;
      const envio = doc.envio;
      const envioNode = this.envioNode(envio);
      graph.addNode(envioNode);
      const seed = seeds.find((item) => item.tipo === doc.tipo && Number(item.id) === Number(doc.documentoId));
      graph.addEdge(seed?.nodeId || envioNode.id, envioNode.id, 'Envio');

      (envio.documentos || []).forEach((relatedDoc: any) => {
        const relatedNode = this.nodeFromEnvioDocumento(relatedDoc);
        graph.addNode(relatedNode);
        graph.addEdge(envioNode.id, relatedNode.id, relatedDoc.tipo);
      });
    });
  }

  private async buildPedido(id: number) {
    const pedido = await this.prisma.pedidoProduccion.findUnique({
      where: { id },
      include: {
        cliente: true,
        pagos: true,
        avances: true,
        postventa: true,
        unificaciones: { include: { produccionUnificado: true } },
      },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    const graph = this.createGraph();
    const root = this.pedidoNode(pedido, true);
    graph.addNode(root);
    const seeds = [{ tipo: 'pedido', id, nodeId: root.id }];

    (pedido.pagos || []).forEach((pago: any) => {
      const node = this.pagoPedidoNode(pago, id);
      graph.addNode(node);
      graph.addEdge(root.id, node.id, pago.tipo === 'anticipo' ? 'Anticipo' : 'Pago');
      seeds.push({ tipo: 'pagoPedido', id: Number(pago.id), nodeId: node.id });
    });

    (pedido.avances || []).forEach((avance: any) => {
      const node = this.avanceNode(avance, id);
      graph.addNode(node);
      graph.addEdge(root.id, node.id, 'Avance');
    });

    if (pedido.postventa) {
      const node = this.postventaNode(pedido.postventa);
      graph.addNode(node);
      graph.addEdge(root.id, node.id, pedido.postventaCobro === 'sin_cobro' ? 'Postventa sin cobro' : 'Postventa');
    }

    (pedido.unificaciones || []).forEach((row: any) => {
      const node = this.unificacionNode(row.produccionUnificado);
      graph.addNode(node);
      graph.addEdge(root.id, node.id, 'Unificacion');
    });

    await this.addEnvioLinks(graph, seeds);
    return graph.result();
  }

  private async buildVenta(id: number) {
    const venta = await this.prisma.venta.findUnique({
      where: { id },
      include: {
        cliente: true,
        pagos: true,
        solicitudesTraslado: {
          include: {
            desdeBodega: true,
            haciaBodega: true,
            traslados: { include: { desdeBodega: true, haciaBodega: true } },
          },
        },
      },
    });
    if (!venta) throw new NotFoundException('Venta no encontrada');

    const graph = this.createGraph();
    const root = this.ventaNode(venta, true);
    graph.addNode(root);
    const seeds = [{ tipo: 'venta', id, nodeId: root.id }];

    (venta.pagos || []).forEach((pago: any) => {
      const node = this.pagoVentaNode(pago);
      graph.addNode(node);
      graph.addEdge(root.id, node.id, 'Pago');
      seeds.push({ tipo: 'pagoVenta', id: Number(pago.id), nodeId: node.id });
    });

    (venta.solicitudesTraslado || []).forEach((solicitud: any) => {
      const node = this.solicitudTrasladoNode(solicitud);
      graph.addNode(node);
      graph.addEdge(root.id, node.id, 'Traslado requerido');
      (solicitud.traslados || []).forEach((traslado: any) => {
        const trasladoNode = this.trasladoNode(traslado);
        graph.addNode(trasladoNode);
        graph.addEdge(node.id, trasladoNode.id, 'Movimiento');
      });
    });

    await this.addEnvioLinks(graph, seeds);
    return graph.result();
  }

  private async buildPagoPedido(id: number) {
    const pago = await this.prisma.pagoPedido.findUnique({
      where: { id },
      include: { pedido: { include: { cliente: true } } },
    });
    if (!pago) throw new NotFoundException('Pago no encontrado');

    const graph = this.createGraph();
    const root = this.pagoPedidoNode(pago, pago.pedidoId, true);
    const pedido = this.pedidoNode(pago.pedido);
    graph.addNode(root);
    graph.addNode(pedido);
    graph.addEdge(pedido.id, root.id, pago.tipo === 'anticipo' ? 'Anticipo' : 'Pago');
    await this.addEnvioLinks(graph, [{ tipo: 'pagoPedido', id, nodeId: root.id }, { tipo: 'pedido', id: pago.pedidoId, nodeId: pedido.id }]);
    return graph.result();
  }

  private async buildPagoVenta(id: number) {
    const pago = await this.prisma.pagoVenta.findUnique({
      where: { id },
      include: { venta: { include: { cliente: true } } },
    });
    if (!pago) throw new NotFoundException('Pago no encontrado');

    const graph = this.createGraph();
    const root = this.pagoVentaNode(pago, true);
    const venta = this.ventaNode(pago.venta);
    graph.addNode(root);
    graph.addNode(venta);
    graph.addEdge(venta.id, root.id, 'Pago');
    await this.addEnvioLinks(graph, [{ tipo: 'pagoVenta', id, nodeId: root.id }, { tipo: 'venta', id: pago.ventaId, nodeId: venta.id }]);
    return graph.result();
  }

  private async buildEnvio(id: number) {
    const envio = await this.prisma.envio.findUnique({
      where: { id },
      include: { documentos: true },
    });
    if (!envio) throw new NotFoundException('Envio no encontrado');

    const graph = this.createGraph();
    const root = this.envioNode(envio, true);
    graph.addNode(root);
    (envio.documentos || []).forEach((doc: any) => {
      const node = this.nodeFromEnvioDocumento(doc);
      graph.addNode(node);
      graph.addEdge(root.id, node.id, doc.tipo);
    });
    return graph.result();
  }

  private async buildTraslado(id: number) {
    const traslado = await this.prisma.traslado.findUnique({
      where: { id },
      include: {
        desdeBodega: true,
        haciaBodega: true,
        solicitudTraslado: { include: { venta: { include: { cliente: true } }, desdeBodega: true, haciaBodega: true } },
      },
    });
    if (!traslado) throw new NotFoundException('Traslado no encontrado');

    const graph = this.createGraph();
    const root = this.trasladoNode(traslado, true);
    graph.addNode(root);
    if (traslado.solicitudTraslado) {
      const solicitud = this.solicitudTrasladoNode(traslado.solicitudTraslado);
      graph.addNode(solicitud);
      graph.addEdge(solicitud.id, root.id, 'Movimiento');
      if (traslado.solicitudTraslado.venta) {
        const venta = this.ventaNode(traslado.solicitudTraslado.venta);
        graph.addNode(venta);
        graph.addEdge(venta.id, solicitud.id, 'Traslado requerido');
      }
    }
    return graph.result();
  }

  private async buildIngreso(id: number) {
    const ingreso = await this.prisma.ingresoInventario.findUnique({
      where: { id },
      include: { bodega: true },
    });
    if (!ingreso) throw new NotFoundException('Ingreso no encontrado');
    const graph = this.createGraph();
    graph.addNode(this.ingresoNode(ingreso, true));
    return graph.result();
  }

  private async buildSolicitudTraslado(id: number) {
    const solicitud = await this.prisma.solicitudTraslado.findUnique({
      where: { id },
      include: {
        venta: { include: { cliente: true } },
        desdeBodega: true,
        haciaBodega: true,
        traslados: { include: { desdeBodega: true, haciaBodega: true } },
      },
    });
    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');
    const graph = this.createGraph();
    const root = this.solicitudTrasladoNode(solicitud, true);
    graph.addNode(root);
    if (solicitud.venta) {
      const venta = this.ventaNode(solicitud.venta);
      graph.addNode(venta);
      graph.addEdge(venta.id, root.id, 'Traslado requerido');
    }
    (solicitud.traslados || []).forEach((traslado: any) => {
      const node = this.trasladoNode(traslado);
      graph.addNode(node);
      graph.addEdge(root.id, node.id, 'Movimiento');
    });
    return graph.result();
  }

  private async buildConteo(id: number) {
    const conteo = await this.prisma.conteoInventario.findUnique({
      where: { id },
      include: { bodega: true },
    });
    if (!conteo) throw new NotFoundException('Conteo no encontrado');
    const graph = this.createGraph();
    graph.addNode(this.conteoNode(conteo, true));
    return graph.result();
  }
}
