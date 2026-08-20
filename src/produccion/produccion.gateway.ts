import { Injectable } from '@nestjs/common';
import { RealtimeRelayService } from '../realtime/realtime-relay.service';

@Injectable()
export class ProduccionGateway {
  constructor(private readonly realtime: RealtimeRelayService) {}

  emitPedidosActualizados(payload?: Record<string, unknown>) {
    this.realtime.emit('produccion:pedidos-actualizados', payload);
  }
}
