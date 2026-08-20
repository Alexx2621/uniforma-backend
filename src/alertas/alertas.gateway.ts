import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class AlertasGateway {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AlertasGateway.name);

  /**
   * Emite sin arriesgar la operacion que dispara el aviso.
   *
   * `server` esta declarado con `!` y Nest lo asigna al levantar el servidor
   * de websockets, pero hasta entonces vale undefined. Como estos emits se
   * llaman dentro de operaciones de negocio (crear un pedido, autorizar un
   * traslado, registrar una venta), un emit sin proteger convierte cualquier
   * peticion que llegue durante el arranque en un error 500 — y Passenger
   * recicla la aplicacion varias veces al dia.
   *
   * El aviso en vivo es una mejora, no un requisito: la alerta ya quedo
   * guardada en la base y se ve igual al refrescar. Fallar la venta por no
   * poder avisar seria cambiar un problema pequeño por uno grande.
   */
  private emitir(evento: string, payload?: Record<string, unknown>) {
    try {
      this.server?.emit(evento, {
        at: new Date().toISOString(),
        ...payload,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo emitir ${evento}: ${(error as Error)?.message}`,
      );
    }
  }

  emitAlertasActualizadas(payload?: Record<string, unknown>) {
    this.emitir('alertas:actualizadas', payload);
  }

  emitMensajeActualizacion(payload: {
    titulo: string;
    mensaje: string;
    enviadoPor?: string;
  }) {
    this.emitir('sistema:actualizacion', payload);
  }

  emitAutorizacionPedidoResuelta(payload: Record<string, unknown>) {
    this.emitir('produccion:autorizacion-resuelta', payload);
  }
}
