import { Test, TestingModule } from '@nestjs/testing';
import { ProduccionService } from './produccion.service';

describe('ProduccionService', () => {
  let service: ProduccionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProduccionService],
    }).compile();

    service = module.get<ProduccionService>(ProduccionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
