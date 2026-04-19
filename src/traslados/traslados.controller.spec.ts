import { Test, TestingModule } from '@nestjs/testing';
import { TrasladosController } from './traslados.controller';

describe('TrasladosController', () => {
  let controller: TrasladosController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrasladosController],
    }).compile();

    controller = module.get<TrasladosController>(TrasladosController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
