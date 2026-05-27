CREATE TABLE `TelaProveedorAlias` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `telaId` INTEGER NOT NULL,
  `proveedorId` INTEGER NOT NULL,
  `codigoProveedor` VARCHAR(191) NULL,
  `nombreProveedor` VARCHAR(191) NOT NULL,
  `descripcionProveedor` MEDIUMTEXT NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  INDEX `TelaProveedorAlias_telaId_idx`(`telaId`),
  INDEX `TelaProveedorAlias_proveedorId_idx`(`proveedorId`),
  INDEX `TelaProveedorAlias_codigoProveedor_idx`(`codigoProveedor`),
  INDEX `TelaProveedorAlias_nombreProveedor_idx`(`nombreProveedor`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IngresoTela` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `correlativo` VARCHAR(191) NOT NULL,
  `facturaProveedorId` INTEGER NULL,
  `proveedorId` INTEGER NULL,
  `fecha` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `estado` VARCHAR(191) NOT NULL DEFAULT 'abierto',
  `observaciones` MEDIUMTEXT NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  UNIQUE INDEX `IngresoTela_correlativo_key`(`correlativo`),
  INDEX `IngresoTela_facturaProveedorId_idx`(`facturaProveedorId`),
  INDEX `IngresoTela_proveedorId_idx`(`proveedorId`),
  INDEX `IngresoTela_estado_idx`(`estado`),
  INDEX `IngresoTela_fecha_idx`(`fecha`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IngresoTelaDetalle` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ingresoTelaId` INTEGER NOT NULL,
  `facturaProveedorDetalleId` INTEGER NULL,
  `telaId` INTEGER NULL,
  `bodegaId` INTEGER NULL,
  `colorId` INTEGER NULL,
  `rolloId` INTEGER NULL,
  `linea` INTEGER NOT NULL DEFAULT 1,
  `proveedorCodigo` VARCHAR(191) NULL,
  `proveedorNombre` VARCHAR(191) NULL,
  `descripcionFactura` MEDIUMTEXT NOT NULL,
  `cantidad` DOUBLE NOT NULL DEFAULT 0,
  `unidad` VARCHAR(191) NULL DEFAULT 'metros',
  `costoUnitario` DOUBLE NOT NULL DEFAULT 0,
  `total` DOUBLE NOT NULL DEFAULT 0,
  `lote` VARCHAR(191) NULL,
  `tono` VARCHAR(191) NULL,
  `ancho` DOUBLE NOT NULL DEFAULT 0,
  `ubicacion` VARCHAR(191) NULL,
  `estado` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
  `observaciones` MEDIUMTEXT NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  INDEX `IngresoTelaDetalle_ingresoTelaId_idx`(`ingresoTelaId`),
  INDEX `IngresoTelaDetalle_facturaProveedorDetalleId_idx`(`facturaProveedorDetalleId`),
  INDEX `IngresoTelaDetalle_telaId_idx`(`telaId`),
  INDEX `IngresoTelaDetalle_bodegaId_idx`(`bodegaId`),
  INDEX `IngresoTelaDetalle_colorId_idx`(`colorId`),
  INDEX `IngresoTelaDetalle_rolloId_idx`(`rolloId`),
  INDEX `IngresoTelaDetalle_estado_idx`(`estado`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TelaProveedorAlias`
  ADD CONSTRAINT `TelaProveedorAlias_telaId_fkey`
  FOREIGN KEY (`telaId`) REFERENCES `Tela`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `TelaProveedorAlias`
  ADD CONSTRAINT `TelaProveedorAlias_proveedorId_fkey`
  FOREIGN KEY (`proveedorId`) REFERENCES `Proveedor`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `IngresoTela`
  ADD CONSTRAINT `IngresoTela_facturaProveedorId_fkey`
  FOREIGN KEY (`facturaProveedorId`) REFERENCES `FacturaProveedor`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `IngresoTela`
  ADD CONSTRAINT `IngresoTela_proveedorId_fkey`
  FOREIGN KEY (`proveedorId`) REFERENCES `Proveedor`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `IngresoTelaDetalle`
  ADD CONSTRAINT `IngresoTelaDetalle_ingresoTelaId_fkey`
  FOREIGN KEY (`ingresoTelaId`) REFERENCES `IngresoTela`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `IngresoTelaDetalle`
  ADD CONSTRAINT `IngresoTelaDetalle_facturaProveedorDetalleId_fkey`
  FOREIGN KEY (`facturaProveedorDetalleId`) REFERENCES `FacturaProveedorDetalle`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `IngresoTelaDetalle`
  ADD CONSTRAINT `IngresoTelaDetalle_telaId_fkey`
  FOREIGN KEY (`telaId`) REFERENCES `Tela`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `IngresoTelaDetalle`
  ADD CONSTRAINT `IngresoTelaDetalle_bodegaId_fkey`
  FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `IngresoTelaDetalle`
  ADD CONSTRAINT `IngresoTelaDetalle_colorId_fkey`
  FOREIGN KEY (`colorId`) REFERENCES `Color`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `IngresoTelaDetalle`
  ADD CONSTRAINT `IngresoTelaDetalle_rolloId_fkey`
  FOREIGN KEY (`rolloId`) REFERENCES `TelaRollo`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
