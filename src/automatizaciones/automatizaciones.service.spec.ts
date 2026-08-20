import { AutomatizacionesService } from './automatizaciones.service';

describe('AutomatizacionesService', () => {
  const create = jest.fn();
  const update = jest.fn();
  const prisma = {
    ejecucionAutomatizacion: { create, update },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({ id: 7 });
    update.mockResolvedValue({ id: 7 });
  });

  it('registra resultado y duracion cuando termina correctamente', async () => {
    const service = new AutomatizacionesService(prisma);
    const resultado = await service.ejecutar('prueba', async () => ({
      total: 3,
    }));

    expect(resultado.ok).toBe(true);
    expect(resultado.resultado).toEqual({ total: 3 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({
          estado: 'exitosa',
          resultado: { total: 3 },
        }),
      }),
    );
  });

  it('registra el error y lo vuelve a propagar', async () => {
    const service = new AutomatizacionesService(prisma);
    await expect(
      service.ejecutar('prueba', async () => {
        throw new Error('fallo controlado');
      }),
    ).rejects.toThrow('fallo controlado');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({
          estado: 'fallida',
          error: 'fallo controlado',
        }),
      }),
    );
  });
});
