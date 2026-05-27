CREATE TABLE `ColorProveedorAlias` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `colorId` INTEGER NOT NULL,
  `proveedorId` INTEGER NOT NULL,
  `codigoProveedor` VARCHAR(191) NULL,
  `nombreProveedor` VARCHAR(191) NOT NULL,
  `descripcionProveedor` MEDIUMTEXT NULL,
  `activo` BOOLEAN NOT NULL DEFAULT true,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  INDEX `ColorProveedorAlias_colorId_idx`(`colorId`),
  INDEX `ColorProveedorAlias_proveedorId_idx`(`proveedorId`),
  INDEX `ColorProveedorAlias_codigoProveedor_idx`(`codigoProveedor`),
  INDEX `ColorProveedorAlias_nombreProveedor_idx`(`nombreProveedor`),
  INDEX `ColorProveedorAlias_activo_idx`(`activo`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ColorProveedorAlias`
  ADD CONSTRAINT `ColorProveedorAlias_colorId_fkey`
  FOREIGN KEY (`colorId`) REFERENCES `Color`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ColorProveedorAlias`
  ADD CONSTRAINT `ColorProveedorAlias_proveedorId_fkey`
  FOREIGN KEY (`proveedorId`) REFERENCES `Proveedor`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
