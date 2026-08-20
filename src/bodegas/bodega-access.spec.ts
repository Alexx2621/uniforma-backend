import { ForbiddenException } from '@nestjs/common';
import { assertBodegaAccess, getAllowedBodegaIds } from './bodega-access';

describe('bodega-access', () => {
  it('permite todas las bodegas cuando el rol vigente en la base es ADMIN', async () => {
    const prisma = {
      usuario: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          bodegaId: null,
          bodega: null,
          bodegasPermitidas: [],
          rol: { nombre: 'ADMIN' },
        }),
      },
    } as any;

    await expect(
      getAllowedBodegaIds(prisma, { id: 7, rol: 'VENDEDOR', permisos: [] }, 'traslados'),
    ).resolves.toBeNull();
    expect(prisma.usuario.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 } }));
  });

  it('mantiene restringido a un usuario que no tiene acceso a la bodega', async () => {
    const prisma = {
      usuario: {
        findUnique: jest.fn().mockResolvedValue({
          id: 8,
          bodegaId: 2,
          bodega: { id: 2, activa: true, permiteTraslados: true },
          bodegasPermitidas: [],
          rol: { nombre: 'VENDEDOR' },
        }),
      },
      bodega: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    await expect(
      assertBodegaAccess(prisma, { id: 8, rol: 'VENDEDOR', permisos: [] }, 9, 'traslados'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
