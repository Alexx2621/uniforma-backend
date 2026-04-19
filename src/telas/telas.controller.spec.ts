import { Test, TestingModule } from '@nestjs/testing';
import { TelasController } from './telas.controller';

describe('TelasController', () => {
  let controller: TelasController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelasController],
    }).compile();

    controller = module.get<TelasController>(TelasController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
