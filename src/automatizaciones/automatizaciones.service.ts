import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AutomatizacionesService {
  private readonly logger = new Logger(AutomatizacionesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ejecutar<T>(clave: string, tarea: () => Promise<T>, origen = 'cpanel') {
    const iniciadaEn = new Date();
    let ejecucionId: number | null = null;

    try {
      const ejecucion = await this.prisma.ejecucionAutomatizacion.create({
        data: { clave, origen, estado: 'ejecutando', iniciadaEn },
        select: { id: true },
      });
      ejecucionId = ejecucion.id;
    } catch (error) {
      // La telemetria nunca debe impedir que se ejecute el trabajo principal.
      this.logger.error(
        `No se pudo iniciar el registro de ${clave}`,
        (error as Error)?.message,
      );
    }

    try {
      const resultado = await tarea();
      const finalizadaEn = new Date();
      if (ejecucionId) {
        await this.actualizarSinInterrumpir(ejecucionId, {
          estado: 'exitosa',
          finalizadaEn,
          duracionMs: finalizadaEn.getTime() - iniciadaEn.getTime(),
          resultado: this.jsonSeguro(resultado),
          error: null,
        });
      }
      return {
        ok: true,
        clave,
        ejecutadoEn: finalizadaEn.toISOString(),
        duracionMs: finalizadaEn.getTime() - iniciadaEn.getTime(),
        resultado,
      };
    } catch (error) {
      const finalizadaEn = new Date();
      if (ejecucionId) {
        await this.actualizarSinInterrumpir(ejecucionId, {
          estado: 'fallida',
          finalizadaEn,
          duracionMs: finalizadaEn.getTime() - iniciadaEn.getTime(),
          error: this.mensajeError(error),
        });
      }
      throw error;
    }
  }

  private jsonSeguro(value: unknown) {
    if (value === undefined) return { completada: true };
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return { completada: true };
    }
  }

  private mensajeError(error: unknown) {
    const mensaje =
      error instanceof Error
        ? error.message
        : `${error || 'Error desconocido'}`;
    return mensaje.slice(0, 4000);
  }

  private async actualizarSinInterrumpir(
    id: number,
    data: Record<string, any>,
  ) {
    try {
      await this.prisma.ejecucionAutomatizacion.update({ where: { id }, data });
    } catch (error) {
      this.logger.error(
        `No se pudo finalizar el registro de automatizacion #${id}`,
        (error as Error)?.message,
      );
    }
  }
}
