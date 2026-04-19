import { Test, TestingModule } from '@nestjs/testing';
import { TelasService } from './telas.service';

describe('TelasService', () => {
  let service: TelasService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TelasService],
    }).compile();

    service = module.get<TelasService>(TelasService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
