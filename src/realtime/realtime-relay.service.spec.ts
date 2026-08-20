import { createHmac } from 'crypto';
import { RealtimeRelayService } from './realtime-relay.service';

describe('RealtimeRelayService', () => {
  const originalUrl = process.env.REALTIME_URL;
  const originalSecret = process.env.REALTIME_SECRET;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.REALTIME_URL;
    else process.env.REALTIME_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.REALTIME_SECRET;
    else process.env.REALTIME_SECRET = originalSecret;
    jest.restoreAllMocks();
  });

  it('firma y publica el evento sin bloquear la operacion principal', async () => {
    process.env.REALTIME_URL = 'https://realtime.example.com/';
    process.env.REALTIME_SECRET = 'secreto-prueba';
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true } as Response);
    const service = new RealtimeRelayService();

    service.emit('alertas:actualizadas', { action: 'created' });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    const body = `${options?.body}`;
    const headers = options?.headers as Record<string, string>;
    const timestamp = `${headers['x-realtime-timestamp']}`;
    const expectedSignature = createHmac('sha256', 'secreto-prueba')
      .update(`${timestamp}.${body}`)
      .digest('hex');

    expect(url).toBe('https://realtime.example.com/emit');
    expect(headers['x-realtime-signature']).toBe(expectedSignature);
    expect(JSON.parse(body)).toMatchObject({
      event: 'alertas:actualizadas',
      payload: { action: 'created' },
    });
  });
});
