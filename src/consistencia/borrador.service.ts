import { BadRequestException, Injectable } from '@nestjs/common';
import { LineaExplicada, Problema } from './analizador.service';

const TOLERANCIA = 0.05;

/** Lo que manda la pantalla mientras se arma el documento. */
export type LineaBorrador = {
  tipoOperacion?: 'venta' | 'pedido';
  producto?: string | null;
  cantidad?: number;
  precioUnit?: number;
  bordado?: number;
  descuento?: number;
  estiloEspecial?: boolean;
  estiloEspecialMonto?: number;
};

export type Borrador = {
  tipo?: 'venta' | 'pedido' | 'orden_mixta';
  lineas?: LineaBorrador[];
  envio?: number;
  recargo?: number;
  anticipo?: number;
  /** Lo que el vendedor dice que se cobro o se acordo. Opcional. */
  esperado?: number | null;
};

/**
 * Revisa un documento mientras se esta armando, antes de guardarlo.
 *
 * El analizador normal trabaja sobre lo ya guardado, asi que solo servia para
 * auditar despues del hecho: para cuando avisaba, el descuadre ya estaba en la
 * base y el cliente ya se habia ido. Aqui se revisan los mismos numeros sobre
 * lo que hay en pantalla, que es cuando todavia se puede corregir.
 *
 * Nada de esto toca la base: son cuentas sobre lo que llega. Por eso tampoco
 * hace falta que el documento exista ni que tenga folio.
 */
@Injectable()
export class BorradorService {
  private redondear(valor?: number | null) {
    return Math.round((Number(valor) || 0) * 100) / 100;
  }

  /**
   * La misma formula que usa la pantalla al calcular cada linea. Si algun dia
   * se cambia alla, hay que cambiarla aqui: que las dos coincidan es lo que
   * hace confiable la revision.
   */
  private subtotal(linea: LineaBorrador) {
    const cantidad = Number(linea.cantidad || 0);
    const precio = Number(linea.precioUnit || 0);
    const bordado = Number(linea.bordado || 0);
    const especial = linea.estiloEspecial ? Number(linea.estiloEspecialMonto || 0) : 0;
    const descuento = 1 - Number(linea.descuento || 0) / 100;
    return this.redondear(cantidad * ((precio + especial) * descuento + bordado));
  }

  private explicar(linea: LineaBorrador) {
    const partes = [`${Number(linea.cantidad || 0)} x ${this.redondear(linea.precioUnit)}`];
    if (linea.estiloEspecial && Number(linea.estiloEspecialMonto)) {
      partes.push(`+ ${this.redondear(linea.estiloEspecialMonto)} de estilo especial`);
    }
    if (Number(linea.descuento)) partes.push(`- ${Number(linea.descuento)}% de descuento`);
    if (Number(linea.bordado)) partes.push(`+ ${this.redondear(linea.bordado)} de bordado c/u`);
    return partes.join(' ');
  }

  /**
   * Busca a que corresponde una diferencia.
   *
   * Es lo que convierte "te faltan Q1,000" en algo accionable. Se compara la
   * diferencia contra los montos que el documento ya conoce —el envio, el
   * descuento de cada linea, el subtotal de cada linea— y si coincide con
   * alguno, ese es casi seguro el culpable. Solo se afirma cuando cuadra
   * exacto: una coincidencia aproximada mandaria a buscar donde no es.
   */
  private atribuir(diferencia: number, lineas: LineaBorrador[], envio: number): string | null {
    const dif = Math.abs(this.redondear(diferencia));
    if (dif <= TOLERANCIA) return null;

    if (Math.abs(dif - this.redondear(envio)) <= TOLERANCIA && envio > 0) {
      return `Coincide exactamente con el envio (${this.redondear(envio)}). Puede que lo hayas cobrado aparte o que sobre en el documento.`;
    }

    for (const [i, linea] of lineas.entries()) {
      const cantidad = Number(linea.cantidad || 0);
      const precio = Number(linea.precioUnit || 0);
      const especial = linea.estiloEspecial ? Number(linea.estiloEspecialMonto || 0) : 0;

      const montoDescuento = this.redondear(cantidad * (precio + especial) * (Number(linea.descuento || 0) / 100));
      if (montoDescuento > 0 && Math.abs(dif - montoDescuento) <= TOLERANCIA) {
        return `Coincide exactamente con el ${linea.descuento}% de descuento de la linea ${i + 1} (${montoDescuento}). Revisa si ese descuento iba o no.`;
      }

      const montoBordado = this.redondear(cantidad * Number(linea.bordado || 0));
      if (montoBordado > 0 && Math.abs(dif - montoBordado) <= TOLERANCIA) {
        return `Coincide exactamente con el bordado de la linea ${i + 1} (${montoBordado}). Revisa si lo cobraste aparte.`;
      }

      const sub = this.subtotal(linea);
      if (sub > 0 && Math.abs(dif - sub) <= TOLERANCIA) {
        return `Coincide exactamente con la linea ${i + 1} completa (${sub}). Puede que falte agregarla o que este de mas.`;
      }
    }
    return null;
  }

  revisar(borrador: Borrador) {
    const lineas = Array.isArray(borrador?.lineas) ? borrador.lineas : [];
    if (!lineas.length) {
      throw new BadRequestException('Todavia no hay lineas que revisar en el documento');
    }

    const envio = Math.max(0, Number(borrador?.envio || 0));
    const recargo = Math.max(0, Number(borrador?.recargo || 0));
    const problemas: Problema[] = [];
    const explicadas: LineaExplicada[] = [];

    let sumaVenta = 0;
    let sumaPedido = 0;

    for (const [i, linea] of lineas.entries()) {
      const sub = this.subtotal(linea);
      if (`${linea.tipoOperacion || 'venta'}` === 'pedido') sumaPedido += sub;
      else sumaVenta += sub;

      explicadas.push({
        n: i + 1,
        producto: linea.producto || `Linea ${i + 1}`,
        cantidad: Number(linea.cantidad || 0),
        precioUnit: this.redondear(linea.precioUnit),
        descuento: Number(linea.descuento || 0),
        bordado: this.redondear(linea.bordado),
        subtotal: sub,
        formula: this.explicar(linea),
      });

      // Avisos sobre la linea misma. No son descuadres todavia, son cosas que
      // casi siempre son un error de captura y se arreglan en dos segundos
      // mientras el cliente sigue enfrente.
      if (Number(linea.cantidad || 0) <= 0) {
        problemas.push({
          nivel: 'linea',
          titulo: `Linea ${i + 1} sin cantidad`,
          esperado: 1,
          encontrado: Number(linea.cantidad || 0),
          diferencia: 0,
          detalle: 'Una linea en cero no suma nada al total',
        });
      } else if (Number(linea.precioUnit || 0) <= 0 && !Number(linea.bordado || 0)) {
        problemas.push({
          nivel: 'linea',
          titulo: `Linea ${i + 1} sin precio`,
          esperado: 0,
          encontrado: 0,
          diferencia: 0,
          detalle: `${linea.producto || 'El producto'} va en cero. Revisa si es a proposito.`,
        });
      }
      if (Number(linea.descuento || 0) >= 100) {
        problemas.push({
          nivel: 'linea',
          titulo: `Linea ${i + 1} con ${linea.descuento}% de descuento`,
          esperado: 0,
          encontrado: Number(linea.descuento || 0),
          diferencia: 0,
          detalle: 'Con ese descuento la linea queda regalada',
        });
      }
    }

    const total = this.redondear(sumaVenta + sumaPedido + envio + recargo);
    const anticipo = Math.max(0, Number(borrador?.anticipo || 0));

    if (anticipo > total + TOLERANCIA) {
      problemas.push({
        nivel: 'documento',
        titulo: 'El anticipo supera el total',
        esperado: total,
        encontrado: this.redondear(anticipo),
        diferencia: this.redondear(anticipo - total),
        detalle: 'Se esta recibiendo mas de lo que vale el documento',
      });
    }

    // El caso que motivo todo esto: cobre una cosa y el documento dice otra.
    const esperado = borrador?.esperado == null ? null : Number(borrador.esperado);
    let atribucion: string | null = null;
    if (esperado != null && Number.isFinite(esperado) && esperado > 0) {
      const diferencia = this.redondear(total - esperado);
      if (Math.abs(diferencia) > TOLERANCIA) {
        atribucion = this.atribuir(diferencia, lineas, envio);
        problemas.push({
          nivel: 'documento',
          titulo: diferencia < 0 ? 'Al documento le falta para llegar a lo cobrado' : 'El documento pasa de lo cobrado',
          esperado: this.redondear(esperado),
          encontrado: total,
          diferencia,
          detalle: atribucion || 'No encontre un monto del documento que explique la diferencia por si solo.',
        });
      }
    }

    return {
      tipo: borrador?.tipo || 'orden_mixta',
      enConstruccion: true,
      lineas: explicadas,
      resumen: {
        sumaLineas: this.redondear(sumaVenta + sumaPedido),
        ...(sumaVenta > 0 && sumaPedido > 0
          ? { subtotalVenta: this.redondear(sumaVenta), subtotalPedido: this.redondear(sumaPedido) }
          : {}),
        envio: this.redondear(envio),
        recargo: this.redondear(recargo),
        totalRegistrado: total,
        ...(anticipo > 0 ? { anticipoTotal: this.redondear(anticipo), saldo: this.redondear(total - anticipo) } : {}),
        ...(esperado != null && Number.isFinite(esperado) && esperado > 0 ? { esperado: this.redondear(esperado) } : {}),
      },
      problemas,
      cuadra: problemas.length === 0,
    };
  }
}
