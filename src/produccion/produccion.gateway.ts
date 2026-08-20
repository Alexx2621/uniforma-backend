import { Injectable } from '@nestjs/common';

/** Actualizaciones por HTTP corto; evita instancias persistentes en Passenger. */
@Injectable()
export class ProduccionGateway {
  emitPedidosActualizados(_payload?: Record<string, unknown>) {}
}
