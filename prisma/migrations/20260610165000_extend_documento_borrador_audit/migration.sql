ALTER TABLE `documentoborrador`
  ADD COLUMN `documentoFinalTipo` VARCHAR(191) NULL,
  ADD COLUMN `documentoFinalId` INTEGER NULL,
  ADD COLUMN `documentoFinalFolio` VARCHAR(191) NULL,
  ADD COLUMN `bloqueadoPorId` INTEGER NULL,
  ADD COLUMN `bloqueadoEn` DATETIME(3) NULL,
  ADD COLUMN `bloqueadoHasta` DATETIME(3) NULL;

CREATE INDEX `documentoborrador_final_idx` ON `documentoborrador`(`documentoFinalTipo`, `documentoFinalId`);
CREATE INDEX `documentoborrador_lock_idx` ON `documentoborrador`(`bloqueadoPorId`, `bloqueadoHasta`);
