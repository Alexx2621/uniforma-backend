ALTER TABLE `IngresoInventario`
  ADD COLUMN `folio` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `IngresoInventario_folio_key` (`folio`);

ALTER TABLE `Traslado`
  ADD COLUMN `folio` VARCHAR(191) NULL,
  ADD COLUMN `responsable` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `Traslado_folio_key` (`folio`);
