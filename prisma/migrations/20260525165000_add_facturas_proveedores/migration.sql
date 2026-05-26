CREATE TABLE `FacturaProveedor` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `proveedorId` INTEGER NULL,
  `proveedorNombre` VARCHAR(191) NULL,
  `proveedorNit` VARCHAR(191) NULL,
  `numeroFactura` VARCHAR(191) NULL,
  `serie` VARCHAR(191) NULL,
  `fechaFactura` DATETIME(3) NULL,
  `fechaVencimiento` DATETIME(3) NULL,
  `fechaRegistro` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `moneda` VARCHAR(191) NOT NULL DEFAULT 'GTQ',
  `subtotal` DOUBLE NOT NULL DEFAULT 0,
  `impuestos` DOUBLE NOT NULL DEFAULT 0,
  `total` DOUBLE NOT NULL DEFAULT 0,
  `estado` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
  `metodoPago` VARCHAR(191) NULL,
  `referenciaPago` VARCHAR(191) NULL,
  `tipoGasto` VARCHAR(191) NULL,
  `descripcion` MEDIUMTEXT NULL,
  `observaciones` MEDIUMTEXT NULL,
  `archivoNombre` VARCHAR(191) NULL,
  `archivoMime` VARCHAR(191) NULL,
  `archivoBase64` MEDIUMTEXT NULL,
  `textoExtraido` LONGTEXT NULL,
  `datosExtraidos` JSON NULL,
  `confianza` DOUBLE NOT NULL DEFAULT 0,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  INDEX `FacturaProveedor_proveedorId_idx`(`proveedorId`),
  INDEX `FacturaProveedor_fechaFactura_idx`(`fechaFactura`),
  INDEX `FacturaProveedor_estado_idx`(`estado`),
  INDEX `FacturaProveedor_numeroFactura_idx`(`numeroFactura`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `FacturaProveedor`
  ADD CONSTRAINT `FacturaProveedor_proveedorId_fkey`
  FOREIGN KEY (`proveedorId`) REFERENCES `Proveedor`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
