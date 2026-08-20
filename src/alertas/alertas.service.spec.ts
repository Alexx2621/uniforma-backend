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
