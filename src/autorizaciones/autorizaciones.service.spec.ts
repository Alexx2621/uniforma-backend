import { AutorizacionesService } from './autorizaciones.service';

describe('AutorizacionesService', () => {
  it('mantiene disponible la bandeja cuando falla una sola fuente', async () => {
    const schemaError = Object.assign(new Error('columna ausente'), { code: 'P2022' });
    const prisma = {
      pedidoProduccionAutorizacion: { findMany: jest.fn().mockRejectedValue(schemaError) },
      solicitudTraslado: { findMany: jest.fn().mockResolvedValue([]) },
      cambioDevolucion: { findMany: jest.fn().mockResolvedValue([]) },
      ventaEspecialAutorizacion: { findMany: jest.fn().mockResolvedValue([]) },
      ajustePagoPedido: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const service = new AutorizacionesService(prisma);

    const result = await service.listar(
      { estado: 'pendiente' },
      { id: 1, rol: 'ADMIN', permisos: [] },
    );

    expect(result.rows).toEqual([]);
    expect(result.stats).toEqual({ total: 0 });
    expect(result.warnings).toEqual([{ tipo: 'pedido', code: 'P2022' }]);
  });
});
