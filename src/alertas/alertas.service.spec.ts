import { AlertasService } from './alertas.service';

describe('AlertasService - solicitudes de traslado', () => {
  const alertaUsuario = {
    id: 1,
    usuarioId: 10,
    tipo: 'solicitud_traslado',
    titulo: 'Solicitud',
    mensaje: 'Pendiente',
    payload: JSON.stringify({ solicitudTrasladoId: 31 }),
    leida: false,
    creadaEn: new Date(),
    leidaEn: null,
  };
  const prisma = {
    alertaInterna: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    solicitudTraslado: { findMany: jest.fn() },
  } as any;
  const gateway = { emitAlertasActualizadas: jest.fn() } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.alertaInterna.updateMany.mockResolvedValue({ count: 2 });
  });

  it('marca las alertas de todos los destinatarios al resolverse', async () => {
    prisma.alertaInterna.findMany.mockResolvedValue([
      alertaUsuario,
      { ...alertaUsuario, id: 2, usuarioId: 11 },
      {
        ...alertaUsuario,
        id: 3,
        payload: JSON.stringify({ solicitudTrasladoId: 99 }),
      },
    ]);
    const service = new AlertasService(prisma, gateway);

    await service.marcarAlertasSolicitudTrasladoLeidas([31]);

    expect(prisma.alertaInterna.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] } },
      data: { leida: true, leidaEn: expect.any(Date) },
    });
    expect(gateway.emitAlertasActualizadas).toHaveBeenCalled();
  });

  it('limpia una alerta historica si la solicitud ya fue resuelta', async () => {
    prisma.alertaInterna.findMany
      .mockResolvedValueOnce([alertaUsuario])
      .mockResolvedValueOnce([alertaUsuario, { ...alertaUsuario, id: 2 }]);
    prisma.solicitudTraslado.findMany.mockResolvedValue([]);
    const service = new AlertasService(prisma, gateway);

    const alertas = await service.listarPorUsuario(10);

    expect(alertas[0].leida).toBe(true);
    expect(prisma.alertaInterna.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] } },
      data: { leida: true, leidaEn: expect.any(Date) },
    });
  });
});

describe('AlertasService - planificador en cPanel', () => {
  const originalOperaciones = process.env.OPERACIONES_CRON_TOKEN;
  const originalAlertas = process.env.ALERTAS_CRON_TOKEN;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalOperaciones === undefined)
      delete process.env.OPERACIONES_CRON_TOKEN;
    else process.env.OPERACIONES_CRON_TOKEN = originalOperaciones;
    if (originalAlertas === undefined) delete process.env.ALERTAS_CRON_TOKEN;
    else process.env.ALERTAS_CRON_TOKEN = originalAlertas;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  it('no crea un intervalo cuando el cron externo esta configurado', () => {
    process.env.OPERACIONES_CRON_TOKEN = 'configurado';
    const intervalSpy = jest.spyOn(global, 'setInterval');
    const service = new AlertasService({} as any, {} as any);

    service.onModuleInit();

    expect(intervalSpy).not.toHaveBeenCalled();
  });

  it('no crea intervalos dentro de las instancias de Passenger', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OPERACIONES_CRON_TOKEN;
    delete process.env.ALERTAS_CRON_TOKEN;
    const intervalSpy = jest.spyOn(global, 'setInterval');
    const service = new AlertasService({} as any, {} as any);

    service.onModuleInit();

    expect(intervalSpy).not.toHaveBeenCalled();
  });
});
