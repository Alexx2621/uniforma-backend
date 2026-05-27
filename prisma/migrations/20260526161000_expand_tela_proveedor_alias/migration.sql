ALTER TABLE `TelaProveedorAlias`
  ADD COLUMN `colorId` INTEGER NULL,
  ADD COLUMN `colorProveedor` VARCHAR(191) NULL,
  ADD COLUMN `unidad` VARCHAR(191) NULL DEFAULT 'metros',
  ADD COLUMN `ancho` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `activo` BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX `TelaProveedorAlias_colorId_idx` ON `TelaProveedorAlias`(`colorId`);
CREATE INDEX `TelaProveedorAlias_activo_idx` ON `TelaProveedorAlias`(`activo`);

ALTER TABLE `TelaProveedorAlias`
  ADD CONSTRAINT `TelaProveedorAlias_colorId_fkey`
  FOREIGN KEY (`colorId`) REFERENCES `Color`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
