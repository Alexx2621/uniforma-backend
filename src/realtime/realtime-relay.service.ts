import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';

@Injectable()
export class RealtimeRelayService {
  private readonly logger = new Logger(RealtimeRelayService.name);
  private readonly url = `${process.env.REALTIME_URL || ''}`.trim().replace(/\/+$/, '');
  private readonly secret = `${process.env.REALTIME_SECRET || ''}`.trim();
  private warnedMissingConfig = false;

  emit(event: string, payload?: Record<string, unknown>) {
    if (!this.url || !this.secret) {
      if (!this.warnedMissingConfig) {
        this.warnedMissingConfig = true;
        this.logger.warn(
          'Tiempo real externo desactivado: configura REALTIME_URL y REALTIME_SECRET',
        );
      }
      return;
    }

    const body = JSON.stringify({
      event,
      payload: {
        at: new Date().toISOString(),
        ...payload,
      },
      messageId: randomUUID(),
    });
    const timestamp = `${Date.now()}`;
    const signature = createHmac('sha256', this.secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    void fetch(`${this.url}/emit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-realtime-timestamp': timestamp,
        'x-realtime-signature': signature,
      },
      body,
      signal: AbortSignal.timeout(1800),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      })
      .catch((error) => {
        this.logger.warn(
          `No se pudo publicar ${event}: ${(error as Error)?.message || error}`,
        );
      });
  }
}
