import { Test, TestingModule } from '@nestjs/testing';
import { TrasladosService } from './traslados.service';

describe('TrasladosService', () => {
  let service: TrasladosService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TrasladosService],
    }).compile();

    service = module.get<TrasladosService>(TrasladosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
