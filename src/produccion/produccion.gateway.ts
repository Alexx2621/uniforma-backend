import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ProduccionGateway {
  @WebSocketServer()
  server!: Server;

  emitPedidosActualizados(payload?: Record<string, unknown>) {
    this.server.emit('produccion:pedidos-actualizados', {
      at: new Date().toISOString(),
      ...payload,
    });
  }
}
