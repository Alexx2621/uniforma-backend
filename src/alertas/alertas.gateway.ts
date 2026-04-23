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
}
