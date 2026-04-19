import { Test, TestingModule } from '@nestjs/testing';
import { TallasController } from './tallas.controller';

describe('TallasController', () => {
  let controller: TallasController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TallasController],
    }).compile();

    controller = module.get<TallasController>(TallasController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
