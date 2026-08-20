import { TrasladosService } from './traslados.service';

describe('TrasladosService - autorizacion concurrente', () => {
  const solicitud = {
    id: 31,
    estado: 'PENDIENTE_APROBACION',
    ventaId: null,
    desdeBodegaId: 2,
    haciaBodegaId: 4,
    solicitanteId: null,
    observaciones: 'Solicitud original',
    desdeBodega: { nombre: 'Zona 1' },
    haciaBodega: { nombre: 'Zona 4' },
    detalle: [],
  };
  const tx = {
    solicitudTraslado: {
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    detalleVenta: { updateMany: jest.fn() },
  };
  const prisma = {
    solicitudTraslado: { findUnique: jest.fn() },
    $transaction: jest.fn((callback: (client: any) => unknown) => callback(tx)),
  } as any;
  const alertas = {
    marcarAlertasSolicitudTrasladoLeidas: jest.fn(),
    crearAlertasPorUsuarios: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.solicitudTraslado.findUnique.mockResolvedValue(solicitud);
    tx.solicitudTraslado.updateMany.mockResolvedValue({ count: 1 });
    tx.detalleVenta.updateMany.mockResolvedValue({ count: 0 });
    tx.solicitudTraslado.update.mockResolvedValue({
      ...solicitud,
      estado: 'PENDIENTE',
    });
    alertas.marcarAlertasSolicitudTrasladoLeidas.mockResolvedValue({
      actualizadas: 2,
    });
  });

  it('la primera decision reclama la solicitud y cierra todas las alertas', async () => {
    const service = new TrasladosService(prisma, {} as any, alertas);
    const result = await service.actualizarSolicitudEstado(
      solicitud.id,
      { estado: 'PENDIENTE', resolverAutorizacion: true },
      { id: 8, rol: 'ADMIN' },
    );

    expect(result.estado).toBe('PENDIENTE');
    expect(tx.solicitudTraslado.updateMany).toHaveBeenCalledWith({
      where: { id: solicitud.id, estado: 'PENDIENTE_APROBACION' },
      data: { estado: 'RESOLVIENDO_APROBACION' },
    });
    expect(alertas.marcarAlertasSolicitudTrasladoLeidas).toHaveBeenCalledWith([
      solicitud.id,
    ]);
  });

  it('rechaza una segunda decision si otra sesion gano la carrera', async () => {
    tx.solicitudTraslado.updateMany.mockResolvedValue({ count: 0 });
    const service = new TrasladosService(prisma, {} as any, alertas);

    await expect(
      service.actualizarSolicitudEstado(
        solicitud.id,
        { estado: 'CANCELADO', resolverAutorizacion: true },
        { id: 9, rol: 'ADMIN' },
      ),
    ).rejects.toThrow('Esta solicitud ya fue respondida por otro usuario');

    expect(tx.solicitudTraslado.update).not.toHaveBeenCalled();
    expect(alertas.marcarAlertasSolicitudTrasladoLeidas).not.toHaveBeenCalled();
  });

  it('rechaza una alerta antigua cuando la solicitud ya no esta pendiente', async () => {
    prisma.solicitudTraslado.findUnique.mockResolvedValue({
      ...solicitud,
      estado: 'PENDIENTE',
    });
    const service = new TrasladosService(prisma, {} as any, alertas);

    await expect(
      service.actualizarSolicitudEstado(
        solicitud.id,
        { estado: 'CANCELADO', resolverAutorizacion: true },
        { id: 9, rol: 'ADMIN' },
      ),
    ).rejects.toThrow('Esta solicitud ya fue respondida por otro usuario');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
