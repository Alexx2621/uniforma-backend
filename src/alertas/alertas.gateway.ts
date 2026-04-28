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

  emitAlertasActualizadas(payload?: Record<string, unknown>) {
    this.server.emit('alertas:actualizadas', {
      at: new Date().toISOString(),
      ...payload,
    });
  }

  emitMensajeActualizacion(payload: {
    titulo: string;
    mensaje: string;
    enviadoPor?: string;
  }) {
    this.server.emit('sistema:actualizacion', {
      at: new Date().toISOString(),
      ...payload,
    });
  }
}
