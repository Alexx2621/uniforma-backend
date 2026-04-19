import { Test, TestingModule } from '@nestjs/testing';
import { IngresosService } from './ingresos.service';

describe('IngresosService', () => {
  let service: IngresosService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IngresosService],
    }).compile();

    service = module.get<IngresosService>(IngresosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
