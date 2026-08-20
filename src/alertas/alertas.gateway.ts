import { Injectable } from '@nestjs/common';

/**
 * Adaptador conservado para no mezclar notificaciones con la logica de negocio.
 *
 * En cPanel, cada conexion Socket.IO permanente hace que Passenger levante otra
 * instancia completa de Node. Las alertas se sincronizan mediante consultas
 * HTTP cortas desde el frontend, por lo que emitir aqui es deliberadamente un
 * no-op y el endpoint /socket.io deja de registrarse.
 */
@Injectable()
export class AlertasGateway {
  emitAlertasActualizadas(_payload?: Record<string, unknown>) {}

  emitMensajeActualizacion(payload: {
    titulo: string;
    mensaje: string;
    enviadoPor?: string;
  }) {}

  emitAutorizacionPedidoResuelta(_payload: Record<string, unknown>) {}
}
