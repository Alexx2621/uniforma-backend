import { Test, TestingModule } from '@nestjs/testing';
import { TallasService } from './tallas.service';

describe('TallasService', () => {
  let service: TallasService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TallasService],
    }).compile();

    service = module.get<TallasService>(TallasService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
