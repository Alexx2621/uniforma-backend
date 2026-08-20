import { Injectable } from '@nestjs/common';
import { RealtimeRelayService } from '../realtime/realtime-relay.service';

@Injectable()
export class AlertasGateway {
  constructor(private readonly realtime: RealtimeRelayService) {}

  emitAlertasActualizadas(payload?: Record<string, unknown>) {
    this.realtime.emit('alertas:actualizadas', payload);
  }

  emitMensajeActualizacion(payload: {
    titulo: string;
    mensaje: string;
    enviadoPor?: string;
  }) {
    this.realtime.emit('sistema:actualizacion', payload);
  }

  emitAutorizacionPedidoResuelta(payload: Record<string, unknown>) {
    this.realtime.emit('produccion:autorizacion-resuelta', payload);
  }
}
