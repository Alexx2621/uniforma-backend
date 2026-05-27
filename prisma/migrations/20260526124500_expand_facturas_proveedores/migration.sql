ALTER TABLE `FacturaProveedor`
  ADD COLUMN `numeroAutorizacion` VARCHAR(191) NULL,
  ADD COLUMN `numeroAcceso` VARCHAR(191) NULL,
  ADD COLUMN `numeroCertificacion` VARCHAR(191) NULL,
  ADD COLUMN `tipoDocumento` VARCHAR(191) NULL,
  ADD COLUMN `condicionPago` VARCHAR(191) NULL,
  ADD COLUMN `receptorNombre` VARCHAR(191) NULL,
  ADD COLUMN `receptorNit` VARCHAR(191) NULL,
  ADD COLUMN `receptorDireccion` MEDIUMTEXT NULL,
  ADD COLUMN `certificadorNombre` VARCHAR(191) NULL,
  ADD COLUMN `certificadorNit` VARCHAR(191) NULL,
  ADD COLUMN `fechaCertificacion` DATETIME(3) NULL;

CREATE INDEX `FacturaProveedor_numeroAutorizacion_idx` ON `FacturaProveedor`(`numeroAutorizacion`);

CREATE TABLE `FacturaProveedorDetalle` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `facturaId` INTEGER NOT NULL,
  `linea` INTEGER NOT NULL DEFAULT 1,
  `cantidad` DOUBLE NOT NULL DEFAULT 0,
  `unidad` VARCHAR(191) NULL,
  `tipo` VARCHAR(191) NULL,
  `descripcion` MEDIUMTEXT NOT NULL,
  `precioUnitario` DOUBLE NOT NULL DEFAULT 0,
  `descuento` DOUBLE NOT NULL DEFAULT 0,
  `impuestoNombre` VARCHAR(191) NULL,
  `impuestoMonto` DOUBLE NOT NULL DEFAULT 0,
  `total` DOUBLE NOT NULL DEFAULT 0,
  `datosExtraidos` JSON NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  INDEX `FacturaProveedorDetalle_facturaId_idx`(`facturaId`),
  INDEX `FacturaProveedorDetalle_descripcion_idx`(`descripcion`(100)),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `FacturaProveedorDetalle`
  ADD CONSTRAINT `FacturaProveedorDetalle_facturaId_fkey`
  FOREIGN KEY (`facturaId`) REFERENCES `FacturaProveedor`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
