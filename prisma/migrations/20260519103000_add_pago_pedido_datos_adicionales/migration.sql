ALTER TABLE `PagoPedido`
  ADD COLUMN `numeroEnvio` VARCHAR(191) NULL,
  ADD COLUMN `numeroRecibo` VARCHAR(191) NULL,
  ADD COLUMN `referenciaDocumento` VARCHAR(191) NULL,
  ADD COLUMN `observacionesPago` MEDIUMTEXT NULL;
