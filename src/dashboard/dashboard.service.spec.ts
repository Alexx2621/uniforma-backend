import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

describe('DashboardService preferences', () => {
  const actualizadoEn = new Date('2026-08-14T18:00:00.000Z');
  let prisma: any;
  let service: DashboardService;

  beforeEach(() => {
    prisma = {
      preferenciaDashboard: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };
    service = new DashboardService(prisma);
  });

  it('obtiene únicamente las preferencias del usuario autenticado', async () => {
    prisma.preferenciaDashboard.findUnique.mockResolvedValue({
      version: 2,
      data: { version: 2, order: ['sales-range'], hidden: [], layouts: {} },
      actualizadoEn,
    });

    const result = await service.obtenerPreferencias({ id: 42 });

    expect(prisma.preferenciaDashboard.findUnique).toHaveBeenCalledWith({
      where: { usuarioId: 42 },
      select: { version: true, data: true, actualizadoEn: true },
    });
    expect(result.updatedAt).toBe(actualizadoEn.toISOString());
  });

  it('normaliza duplicados y guarda con upsert por usuario', async () => {
    const expected = {
      version: 2,
      order: ['sales-range', 'tasks'],
      hidden: ['tasks'],
      layouts: { 'sales-range': { columns: 6, height: 240 } },
    };
    prisma.preferenciaDashboard.upsert.mockResolvedValue({
      version: 2,
      data: expected,
      actualizadoEn,
    });

    const result = await service.guardarPreferencias(
      { id: 42 },
      { ...expected, order: ['sales-range', 'sales-range', 'tasks'] },
    );

    expect(prisma.preferenciaDashboard.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { usuarioId: 42 },
      create: expect.objectContaining({ usuarioId: 42, version: 2, data: expected }),
      update: { version: 2, data: expected },
    }));
    expect(result.preferences).toEqual(expected);
  });

  it.each([
    [{ version: 1, order: [], hidden: [], layouts: {} }, 'versión'],
    [{ version: 2, order: ['INVALIDO'], hidden: [], layouts: {} }, 'identificador'],
    [{ version: 2, order: [], hidden: [], layouts: { tasks: { columns: 2 } } }, 'ancho'],
    [{ version: 2, order: [], hidden: [], layouts: { tasks: { columns: 6, height: 99 } } }, 'altura'],
  ])('rechaza configuraciones inválidas: %s', async (preferences, _reason) => {
    await expect(service.guardarPreferencias({ id: 42 }, preferences)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.preferenciaDashboard.upsert).not.toHaveBeenCalled();
  });

  it('no permite acceder sin un usuario autenticado válido', async () => {
    await expect(service.obtenerPreferencias({})).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.guardarPreferencias({ id: 0 }, {})).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
