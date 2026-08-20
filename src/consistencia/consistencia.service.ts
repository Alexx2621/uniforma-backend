import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AlertasService } from '../alertas/alertas.service';
import { StatusService } from '../status/status.service';

type Chequeo = {
  key: string;
  title: string;
  description: string;
  severity: string;
  count: number;
  ok: boolean;
  registros: Array<Record<string, any>>;
  muestraParcial: boolean;
};

/**
 * Cada chequeo apunta a una entidad distinta y trae sus campos con nombres
 * propios. Este mapa evita repartir esa traduccion por todo el servicio.
 */
const MAPEO: Record<string, { entidad: string; referencia?: string; diferencia?: string }> = {
  inventario_negativo: { entidad: 'inventario', referencia: 'codigo', diferencia: 'stock' },
  productos_sin_stock_max: { entidad: 'producto', referencia: 'codigo' },
  pedidos_total_inconsistente: { entidad: 'pedido', referencia: 'folio', diferencia: 'diferencia' },
  ventas_total_inconsistente: { entidad: 'venta', referencia: 'folio', diferencia: 'diferencia' },
  pagos_pedido_mayor_total: { entidad: 'pedido', referencia: 'folio', diferencia: 'excedente' },
  orden_mixta_con_saldo_negativo: { entidad: 'orden_mixta', referencia: 'folio', diferencia: 'saldoTotal' },
};

@Injectable()
export class ConsistenciaService {
  private readonly logger = new Logger(ConsistenciaService.name);

  constructor(
    private prisma: PrismaService,
    private status: StatusService,
    private alertas: AlertasService,
  ) {}

  /**
   * Diagnostico por reglas: mira la forma del descuadre y dice que suele
   * causarlo. No es adivinacion — cada regla describe un caso concreto que se
   * reconoce por los numeros. Cuando ninguna encaja, lo dice en vez de
   * inventar una explicacion.
   */
  private diagnosticar(chequeo: string, r: Record<string, any>): string {
    const n = (v: unknown) => Number(v || 0);

    if (chequeo === 'ventas_total_inconsistente' || chequeo === 'pedidos_total_inconsistente') {
      const lineas = n(r.sumaLineas);
      const envio = n(r.envio);
      const recargo = n(r.recargo);
      const registrado = n(r.totalRegistrado);
      const diferencia = n(r.diferencia);

      if (registrado === 0 && lineas + envio + recargo > 0) {
        return 'El total quedo en cero aunque el documento tiene lineas. Apunta a que el total nunca se recalculo al guardar.';
      }
      if (lineas === 0 && registrado > 0) {
        return 'Hay total registrado pero ninguna linea. O se borraron las lineas despues de guardar, o nunca se grabaron.';
      }
      if (Math.abs(diferencia - envio) < 0.05 && envio > 0) {
        return `La diferencia coincide con el envio (${envio.toFixed(2)}): el total se calculo sin sumarlo.`;
      }
      if (Math.abs(diferencia - recargo) < 0.05 && recargo > 0) {
        return `La diferencia coincide con el recargo (${recargo.toFixed(2)}): el total se calculo sin sumarlo.`;
      }
      if (Math.abs(diferencia + envio) < 0.05 && envio > 0) {
        return `El envio (${envio.toFixed(2)}) parece haberse sumado dos veces al total.`;
      }
      return `Las lineas suman ${lineas.toFixed(2)} y el total dice ${registrado.toFixed(2)}. Revisa linea por linea: suele ser una que se edito despues de cerrar el documento.`;
    }

    if (chequeo === 'pagos_pedido_mayor_total') {
      return `Se pago ${n(r.totalPagado).toFixed(2)} sobre un total de ${n(r.totalEstimado).toFixed(2)}. O se bajo el total despues de cobrar, o hay un pago cargado al pedido equivocado.`;
    }

    if (chequeo === 'orden_mixta_con_saldo_negativo') {
      return `El saldo quedo en ${n(r.saldoTotal).toFixed(2)} sobre un total de ${n(r.total).toFixed(2)}. Revisa como se repartieron los anticipos entre la parte de venta y la de pedido.`;
    }

    if (chequeo === 'inventario_negativo') {
      return `Stock en ${n(r.stock)}. Salio mas producto del que habia registrado: casi siempre es una venta o traslado hecho antes de ingresar la mercaderia.`;
    }

    if (chequeo === 'productos_sin_stock_max') {
      return 'Sin stock maximo configurado, este producto no entra en los avisos de reposicion.';
    }

    return 'Sin diagnostico automatico para este tipo de hallazgo.';
  }

  /** Ejecuta los chequeos y deja cada hallazgo registrado con su diagnostico. */
  async registrarHallazgos() {
    const chequeos = (await this.status.getInconsistenciasPublicas()) as Chequeo[];
    const nuevos: Array<{ chequeo: string; referencia: string; severidad: string }> = [];
    const vistos: number[] = [];

    for (const chequeo of chequeos) {
      const mapeo = MAPEO[chequeo.key];
      if (!mapeo) continue;

      for (const registro of chequeo.registros) {
        const entidadId = Number(registro.id ?? registro.productoId ?? 0);
        if (!entidadId) continue;

        const referencia = `${registro[mapeo.referencia || 'folio'] ?? ''}`.trim() || `#${entidadId}`;
        const diferencia = mapeo.diferencia ? Number(registro[mapeo.diferencia] ?? 0) : null;

        const existente = await this.prisma.hallazgoConsistencia.findUnique({
          where: {
            chequeo_entidad_entidadId: {
              chequeo: chequeo.key,
              entidad: mapeo.entidad,
              entidadId,
            },
          },
          select: { id: true, estado: true },
        });

        const datos = {
          chequeo: chequeo.key,
          entidad: mapeo.entidad,
          entidadId,
          referencia,
          severidad: chequeo.severity,
          diferencia,
          diagnostico: this.diagnosticar(chequeo.key, registro),
          datos: registro as any,
        };

        if (!existente) {
          const creado = await this.prisma.hallazgoConsistencia.create({ data: datos });
          vistos.push(creado.id);
          nuevos.push({ chequeo: chequeo.title, referencia, severidad: chequeo.severity });
        } else {
          // Si ya se habia dado por resuelto pero el descuadre sigue ahi, se
          // reabre: la correccion no funciono y hay que saberlo.
          await this.prisma.hallazgoConsistencia.update({
            where: { id: existente.id },
            data: {
              ...datos,
              ...(existente.estado === 'resuelto'
                ? { estado: 'abierto', resueltoEn: null, resolucion: null, resueltoPorId: null }
                : {}),
            },
          });
          vistos.push(existente.id);
        }
      }
    }

    // Lo que ya no aparece es que se cuadro, aunque nadie lo haya marcado.
    const cerrados = await this.prisma.hallazgoConsistencia.updateMany({
      where: { estado: 'abierto', id: { notIn: vistos.length ? vistos : [-1] } },
      data: { estado: 'resuelto', resueltoEn: new Date(), resolucion: 'Dejo de detectarse (corregido sin registrar como se hizo).' },
    });

    if (nuevos.length) await this.avisarNuevos(nuevos);

    return { nuevos: nuevos.length, cerradosAutomaticamente: cerrados.count, abiertos: vistos.length };
  }

  private async avisarNuevos(nuevos: Array<{ chequeo: string; referencia: string; severidad: string }>) {
    try {
      const admins = await this.prisma.usuario.findMany({
        where: { activo: true, rol: { nombre: { in: ['ADMIN', 'ADMINISTRADOR'] } } },
        select: { id: true },
      });
      if (!admins.length) return;

      const criticos = nuevos.filter((n) => n.severidad === 'critica' || n.severidad === 'alta');
      const detalle = nuevos.slice(0, 5).map((n) => `${n.chequeo}: ${n.referencia}`).join('\n');

      await this.alertas.crearAlertasPorUsuarios({
        usuarioIds: admins.map((a) => a.id),
        tipo: 'consistencia_hallazgo',
        titulo: `${nuevos.length} descuadre(s) detectado(s)`,
        mensaje: detalle + (nuevos.length > 5 ? `\n...y ${nuevos.length - 5} mas` : ''),
        payload: { prioridad: criticos.length ? 'alta' : 'normal', total: nuevos.length },
      });
    } catch (error) {
      // Un fallo avisando no debe tumbar el registro de hallazgos.
      this.logger.error('No se pudo avisar de los hallazgos nuevos', (error as Error)?.message);
    }
  }

  async listar(query: { estado?: string; chequeo?: string } = {}) {
    return this.prisma.hallazgoConsistencia.findMany({
      where: {
        ...(query.estado ? { estado: query.estado } : {}),
        ...(query.chequeo ? { chequeo: query.chequeo } : {}),
      },
      orderBy: [{ estado: 'asc' }, { severidad: 'asc' }, { detectadoEn: 'desc' }],
      take: 200,
      include: { resueltoPor: { select: { id: true, usuario: true, nombre: true } } },
    });
  }

  /**
   * Marcar resuelto exige contar que se hizo. Sin esa nota el registro no
   * sirve para nada mas adelante, que es justo el punto de guardarlo.
   */
  async resolver(id: number, data: { resolucion?: string }, user?: { id?: number }) {
    const resolucion = `${data?.resolucion || ''}`.trim();
    if (resolucion.length < 10) {
      throw new BadRequestException('Explica en una frase que hiciste para cuadrarlo; queda como referencia para casos parecidos.');
    }

    const hallazgo = await this.prisma.hallazgoConsistencia.findUnique({ where: { id } });
    if (!hallazgo) throw new BadRequestException('Hallazgo no encontrado');

    return this.prisma.hallazgoConsistencia.update({
      where: { id },
      data: {
        estado: 'resuelto',
        resolucion,
        resueltoEn: new Date(),
        resueltoPorId: user?.id ? Number(user.id) : null,
      },
    });
  }

  /**
   * Casos parecidos ya resueltos. Esto es la memoria en accion: ante un
   * descuadre nuevo, muestra como se arreglaron los anteriores del mismo tipo.
   */
  async casosParecidos(id: number) {
    const hallazgo = await this.prisma.hallazgoConsistencia.findUnique({ where: { id } });
    if (!hallazgo) throw new BadRequestException('Hallazgo no encontrado');

    return this.prisma.hallazgoConsistencia.findMany({
      where: {
        chequeo: hallazgo.chequeo,
        estado: 'resuelto',
        resolucion: { not: null },
        id: { not: id },
      },
      orderBy: { resueltoEn: 'desc' },
      take: 5,
      select: {
        id: true,
        referencia: true,
        diferencia: true,
        resolucion: true,
        resueltoEn: true,
        resueltoPor: { select: { usuario: true, nombre: true } },
      },
    });
  }
}
