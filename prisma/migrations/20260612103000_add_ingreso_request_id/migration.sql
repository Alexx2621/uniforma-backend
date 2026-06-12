ALTER TABLE `IngresoInventario`
  ADD COLUMN `requestId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `IngresoInventario_requestId_key` (`requestId`);
