import { Test, TestingModule } from '@nestjs/testing';
import { ColoresService } from './colores.service';

describe('ColoresService', () => {
  let service: ColoresService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ColoresService],
    }).compile();

    service = module.get<ColoresService>(ColoresService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
