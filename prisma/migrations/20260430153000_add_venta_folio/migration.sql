ALTER TABLE `Venta`
  ADD COLUMN `folio` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Venta_folio_key` ON `Venta`(`folio`);
