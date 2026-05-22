ALTER TABLE `Proveedor`
  ADD COLUMN `razonSocial` VARCHAR(191) NULL,
  ADD COLUMN `nit` VARCHAR(191) NULL,
  ADD COLUMN `puestoContacto` VARCHAR(191) NULL,
  ADD COLUMN `telefonoSecundario` VARCHAR(191) NULL,
  ADD COLUMN `sitioWeb` VARCHAR(191) NULL,
  ADD COLUMN `banco` VARCHAR(191) NULL,
  ADD COLUMN `numeroCuenta` VARCHAR(191) NULL,
  ADD COLUMN `tipoCuenta` VARCHAR(191) NULL,
  ADD COLUMN `diasCredito` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `limiteCredito` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `estado` VARCHAR(191) NOT NULL DEFAULT 'activo',
  ADD COLUMN `observaciones` MEDIUMTEXT NULL,
  ADD COLUMN `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `actualizadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `Proveedor_nombre_idx` ON `Proveedor`(`nombre`);
CREATE INDEX `Proveedor_nit_idx` ON `Proveedor`(`nit`);
CREATE INDEX `Proveedor_estado_idx` ON `Proveedor`(`estado`);

ALTER TABLE `TelaRollo` ADD COLUMN `proveedorId` INTEGER NULL;
CREATE INDEX `TelaRollo_proveedorId_idx` ON `TelaRollo`(`proveedorId`);
ALTER TABLE `TelaRollo` ADD CONSTRAINT `TelaRollo_proveedorId_fkey` FOREIGN KEY (`proveedorId`) REFERENCES `Proveedor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;