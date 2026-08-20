import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

const TOLERANCIA = 0.05;

/** Una linea del documento, ya explicada, para poder mostrar el desglose. */
export type LineaExplicada = {
  n: number;
  producto: string;
  cantidad: number;
  precioUnit: number;
  descuento: number;
  bordado: number;
  subtotal: number;
  /** Como se llego a ese subtotal, en palabras. */
  formula: string;
};

export type Problema = {
  nivel: 'documento' | 'linea';
  titulo: string;
  esperado: number;
  encontrado: number;
  diferencia: number;
  detalle?: string;
};

/**
 * Localiza donde exactamente esta el descuadre de un documento.
 *
 * Los chequeos de consistencia dicen QUE un documento no cuadra; esto dice
 * DONDE: si el total no coincide con la suma de lineas, si es una linea suelta
 * cuyo subtotal esta mal calculado, o si el problema esta en como se repartio
 * el anticipo entre la venta y el pedido de una orden mixta.
 *
 * Todo es aritmetica sobre los datos guardados. No hay estimacion: cada
 * problema reporta que se esperaba, que se encontro y la diferencia exacta.
 */
@Injectable()
export class AnalizadorService {
  constructor(private prisma: PrismaService) {}

  private redondear(valor: number) {
    return Math.round((Number(valor) || 0) * 100) / 100;
  }

  /**
   * Escribe la cuenta de una linea tal como se hace a mano. Es lo que el
   * vendedor necesita ver para saber si el sistema entendio lo mismo que el.
   */
  private explicar(cantidad: any, precio: any, descuento: any, bordado: any, especial = 0) {
    const partes = [`${Number(cantidad || 0)} x ${this.redondear(precio)}`];
    if (especial) partes.push(`+ ${this.redondear(especial)} de estilo especial`);
    if (Number(descuento)) partes.push(`- ${Number(descuento)}% de descuento`);
    if (Number(bordado)) partes.push(`+ ${this.redondear(bordado)} de bordado c/u`);
    return partes.join(' ');
  }

  private comparar(
    problemas: Problema[],
    titulo: string,
    esperado: number,
    encontrado: number,
    detalle?: string,
    nivel: 'documento' | 'linea' = 'documento',
  ) {
    const dif = this.redondear(encontrado - esperado);
    if (Math.abs(dif) > TOLERANCIA) {
      problemas.push({
        nivel,
        titulo,
        esperado: this.redondear(esperado),
        encontrado: this.redondear(encontrado),
        diferencia: dif,
        detalle,
      });
    }
  }

  /** Busca el documento por folio en los tres tipos, sin pedir que se diga cual. */
  async buscarPorFolio(folio: string) {
    const limpio = `${folio || ''}`.trim();
    if (!limpio) throw new BadRequestException('Escribe el folio del documento');

    const orden = await this.prisma.ordenMixta.findFirst({ where: { folio: limpio }, select: { id: true } });
    if (orden) return this.analizarOrdenMixta(orden.id);

    const venta = await this.prisma.venta.findFirst({ where: { folio: limpio }, select: { id: true } });
    if (venta) return this.analizarVenta(venta.id);

    const pedido = await this.prisma.pedidoProduccion.findFirst({ where: { folio: limpio }, select: { id: true } });
    if (pedido) return this.analizarPedido(pedido.id);

    throw new BadRequestException(`No encontre ningun documento con el folio ${limpio}`);
  }

  async analizarVenta(id: number) {
    const venta = await this.prisma.venta.findUnique({
      where: { id },
      include: {
        detalle: { include: { producto: { select: { nombre: true, codigo: true } } } },
        pagos: true,
        bodega: { select: { nombre: true } },
      },
    });
    if (!venta) throw new BadRequestException('Venta no encontrada');

    const problemas: Problema[] = [];
    const v = venta as any;

    // Cada linea: su subtotal guardado contra lo que dan sus propios numeros.
    let sumaLineas = 0;
    const lineas: LineaExplicada[] = [];
    for (const [i, linea] of (v.detalle as any[]).entries()) {
      const base = Number(linea.precioUnit || 0) * (1 - Number(linea.descuento || 0) / 100);
      const calculado = this.redondear(Number(linea.cantidad || 0) * (base + Number(linea.bordado || 0)));
      sumaLineas += Number(linea.subtotal || 0);
      lineas.push({
        n: i + 1,
        producto: linea.producto?.nombre || linea.descripcion || 'Producto',
        cantidad: Number(linea.cantidad || 0),
        precioUnit: this.redondear(linea.precioUnit),
        descuento: Number(linea.descuento || 0),
        bordado: this.redondear(linea.bordado),
        subtotal: this.redondear(linea.subtotal),
        formula: this.explicar(linea.cantidad, linea.precioUnit, linea.descuento, linea.bordado),
      });
      this.comparar(
        problemas,
        `Linea ${i + 1}`,
        calculado,
        Number(linea.subtotal || 0),
        `${linea.cantidad} x ${this.redondear(linea.precioUnit)}${Number(linea.descuento) ? ` con ${linea.descuento}% descuento` : ''}${Number(linea.bordado) ? ` + ${this.redondear(linea.bordado)} de bordado` : ''}`,
        'linea',
      );
    }

    this.comparar(
      problemas,
      'Total contra suma de lineas',
      this.redondear(sumaLineas + Number(v.envio || 0) + Number(v.recargo || 0)),
      Number(v.total || 0),
      `Lineas ${this.redondear(sumaLineas)} + envio ${this.redondear(v.envio)} + recargo ${this.redondear(v.recargo)}`,
    );

    const pagado = (v.pagos as any[]).reduce((s, p) => s + Number(p.monto || 0), 0);
    if (pagado > Number(v.total || 0) + TOLERANCIA) {
      this.comparar(problemas, 'Pagos contra total', Number(v.total || 0), pagado, 'Se cobro mas que el total de la venta');
    }

    return {
      tipo: 'venta',
      id: v.id,
      folio: v.folio,
      fecha: v.fecha,
      bodega: v.bodega?.nombre || null,
      lineas,
      resumen: {
        sumaLineas: this.redondear(sumaLineas),
        envio: this.redondear(v.envio),
        recargo: this.redondear(v.recargo),
        totalRegistrado: this.redondear(v.total),
        pagado: this.redondear(pagado),
        saldo: this.redondear(Number(v.total || 0) - pagado),
      },
      problemas,
      cuadra: problemas.length === 0,
    };
  }

  async analizarPedido(id: number) {
    const pedido = await this.prisma.pedidoProduccion.findUnique({
      where: { id },
      include: {
        detalle: { include: { producto: { select: { nombre: true, codigo: true } } } },
        pagos: true,
      },
    });
    if (!pedido) throw new BadRequestException('Pedido no encontrado');

    const problemas: Problema[] = [];
    const p = pedido as any;

    let sumaLineas = 0;
    const lineas: LineaExplicada[] = [];
    for (const [i, linea] of (p.detalle as any[]).entries()) {
      const especial = linea.estiloEspecial ? Number(linea.estiloEspecialMonto || 0) : 0;
      const base = (Number(linea.precioUnit || 0) + especial) * (1 - Number(linea.descuento || 0) / 100);
      const calculado = this.redondear(Number(linea.cantidad || 0) * (base + Number(linea.bordado || 0)));
      lineas.push({
        n: i + 1,
        producto: linea.producto?.nombre || linea.descripcion || 'Producto',
        cantidad: Number(linea.cantidad || 0),
        precioUnit: this.redondear(linea.precioUnit),
        descuento: Number(linea.descuento || 0),
        bordado: this.redondear(linea.bordado),
        subtotal: calculado,
        formula: this.explicar(linea.cantidad, linea.precioUnit, linea.descuento, linea.bordado, especial),
      });
      // El pedido no guarda subtotal por linea: la suma calculada ES la
      // referencia, y lo que se compara es el total del documento.
      sumaLineas += calculado;
      if (Number(linea.cantidad || 0) <= 0 || Number(linea.precioUnit || 0) < 0) {
        problemas.push({
          nivel: 'linea',
          titulo: `Linea ${i + 1} con datos invalidos`,
          esperado: 0,
          encontrado: calculado,
          diferencia: calculado,
          detalle: `cantidad ${linea.cantidad}, precio ${linea.precioUnit}`,
        });
      }
    }

    this.comparar(
      problemas,
      'Total contra suma de lineas',
      this.redondear(sumaLineas + Number(p.envio || 0) + Number(p.recargo || 0)),
      Number(p.totalEstimado || 0),
      `Lineas ${this.redondear(sumaLineas)} + envio ${this.redondear(p.envio)} + recargo ${this.redondear(p.recargo)}`,
    );

    const pagado = (p.pagos as any[]).reduce((s, x) => s + Number(x.monto || 0), 0);
    if (pagado > Number(p.totalEstimado || 0) + TOLERANCIA) {
      this.comparar(problemas, 'Pagos contra total', Number(p.totalEstimado || 0), pagado, 'Se cobro mas que el total del pedido');
    }

    return {
      tipo: 'pedido',
      id: p.id,
      folio: p.folio,
      fecha: p.fecha,
      lineas,
      resumen: {
        sumaLineas: this.redondear(sumaLineas),
        envio: this.redondear(p.envio),
        recargo: this.redondear(p.recargo),
        totalRegistrado: this.redondear(p.totalEstimado),
        pagado: this.redondear(pagado),
        saldo: this.redondear(Number(p.totalEstimado || 0) - pagado),
      },
      problemas,
      cuadra: problemas.length === 0,
    };
  }

  /**
   * El caso mas enredado: la orden mixta tiene su propia copia de los
   * subtotales y de los anticipos repartidos entre la venta y el pedido, asi
   * que el descuadre puede estar en la orden, en cualquiera de los dos
   * documentos hijos, o en el reparto.
   */
  async analizarOrdenMixta(id: number) {
    const orden = await this.prisma.ordenMixta.findUnique({
      where: { id },
      include: { detalle: true },
    });
    if (!orden) throw new BadRequestException('Orden mixta no encontrada');

    const o = orden as any;
    const problemas: Problema[] = [];

    this.comparar(
      problemas,
      'Total contra subtotales',
      this.redondear(Number(o.subtotalVenta || 0) + Number(o.subtotalPedido || 0) + Number(o.envio || 0)),
      Number(o.total || 0),
      `Venta ${this.redondear(o.subtotalVenta)} + pedido ${this.redondear(o.subtotalPedido)} + envio ${this.redondear(o.envio)}`,
    );

    this.comparar(
      problemas,
      'Anticipo total contra su reparto',
      this.redondear(Number(o.anticipoVenta || 0) + Number(o.anticipoPedido || 0)),
      Number(o.anticipoTotal || 0),
      `A la venta ${this.redondear(o.anticipoVenta)} + al pedido ${this.redondear(o.anticipoPedido)}`,
    );

    this.comparar(
      problemas,
      'Saldo contra total menos anticipo',
      this.redondear(Number(o.total || 0) - Number(o.anticipoTotal || 0)),
      Number(o.saldoTotal || 0),
      `Total ${this.redondear(o.total)} - anticipo ${this.redondear(o.anticipoTotal)}`,
    );

    // Los documentos hijos: si la orden dice un subtotal y la venta o el
    // pedido dicen otro, ahi esta el descuadre.
    const hijos: any[] = [];
    if (o.ventaId) {
      const venta = await this.analizarVenta(o.ventaId);
      hijos.push(venta);
      this.comparar(
        problemas,
        'Subtotal de venta contra la venta real',
        this.redondear(venta.resumen.sumaLineas),
        Number(o.subtotalVenta || 0),
        `La venta ${venta.folio} suma ${venta.resumen.sumaLineas} en lineas`,
      );
    }
    if (o.pedidoId) {
      const pedido = await this.analizarPedido(o.pedidoId);
      hijos.push(pedido);
      this.comparar(
        problemas,
        'Subtotal de pedido contra el pedido real',
        this.redondear(pedido.resumen.sumaLineas),
        Number(o.subtotalPedido || 0),
        `El pedido ${pedido.folio} suma ${pedido.resumen.sumaLineas} en lineas`,
      );
    }

    return {
      tipo: 'orden_mixta',
      id: o.id,
      folio: o.folio,
      fecha: o.fecha,
      cliente: o.clienteNombre,
      resumen: {
        subtotalVenta: this.redondear(o.subtotalVenta),
        subtotalPedido: this.redondear(o.subtotalPedido),
        envio: this.redondear(o.envio),
        total: this.redondear(o.total),
        anticipoTotal: this.redondear(o.anticipoTotal),
        anticipoVenta: this.redondear(o.anticipoVenta),
        anticipoPedido: this.redondear(o.anticipoPedido),
        saldoTotal: this.redondear(o.saldoTotal),
      },
      hijos,
      problemas,
      cuadra: problemas.length === 0 && hijos.every((h) => h.cuadra),
    };
  }
}
