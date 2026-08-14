import { ForbiddenException } from '@nestjs/common';
import { AjustesPagosPedidosService } from './ajustes-pagos-pedidos.service';

describe('AjustesPagosPedidosService', () => {
  const prisma: any = {
    ajustePagoPedido: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    pagoPedido: { findUnique: jest.fn() },
  };
  const service = new AjustesPagosPedidosService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('acepta pedidos antiguos y exige doble aprobacion para una diferencia de Q15,000', async () => {
    prisma.ajustePagoPedido.findUnique.mockResolvedValue(null);
    prisma.ajustePagoPedido.findFirst.mockResolvedValue(null);
    prisma.pagoPedido.findUnique.mockResolvedValue({
      id: 8,
      pedidoId: 4,
      monto: 15000,
      metodo: 'efectivo',
      tipo: 'anticipo',
      ubicacion: 'TIENDA',
      pedido: {
        id: 4,
        usuarioId: 10,
        estado: 'pendiente_pago',
        totalEstimado: 30000,
        ubicacion: 'TIENDA',
        pagos: [{ monto: 15000, recargo: 0 }],
      },
    });
    prisma.ajustePagoPedido.create.mockImplementation(({ data }: any) => Promise.resolve(data));

    const result: any = await service.crear(
      { id: 10, rol: 'VENDEDOR', permisos: [] },
      {
        requestId: 'test-historico-0001',
        pedidoId: 4,
        pagoOriginalId: 8,
        montoCorrecto: 30000,
        fechaPagoReal: '2020-01-15',
        metodo: 'efectivo',
        motivo: 'El pago completo quedo respaldado en el recibo original',
        evidenciaReferencia: 'RECIBO-2020-001',
      },
    );

    expect(result.diferencia).toBe(15000);
    expect(result.aprobacionesRequeridas).toBe(2);
    expect(result.fechaPagoReal).toBeInstanceOf(Date);
  });

  it('impide que el solicitante apruebe su propio ajuste', async () => {
    prisma.ajustePagoPedido.findUnique.mockResolvedValue({
      id: 1,
      solicitadoPorId: 10,
      estado: 'pendiente',
      aprobacionesRequeridas: 1,
    });

    await expect(service.aprobar(1, { id: 10, rol: 'ADMIN', permisos: [] }, {}))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('impide que el mismo administrador otorgue las dos aprobaciones', async () => {
    prisma.ajustePagoPedido.findUnique.mockResolvedValue({
      id: 1,
      solicitadoPorId: 10,
      aprobadoPorId: 20,
      estado: 'pendiente_segunda_aprobacion',
      aprobacionesRequeridas: 2,
    });

    await expect(service.aprobar(1, { id: 20, rol: 'ADMIN', permisos: [] }, {}))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
