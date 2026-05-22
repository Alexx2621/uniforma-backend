ALTER TABLE `DetalleVenta`
  ADD COLUMN `solicitudTrasladoId` INTEGER NULL,
  ADD INDEX `DetalleVenta_solicitudTrasladoId_idx` (`solicitudTrasladoId`);

ALTER TABLE `Traslado`
  ADD COLUMN `estado` VARCHAR(191) NOT NULL DEFAULT 'RECIBIDO',
  ADD COLUMN `solicitudTrasladoId` INTEGER NULL,
  ADD INDEX `Traslado_estado_idx` (`estado`),
  ADD INDEX `Traslado_solicitudTrasladoId_idx` (`solicitudTrasladoId`);

CREATE TABLE `SolicitudTraslado` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `folio` VARCHAR(191) NULL,
  `fecha` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ventaId` INTEGER NULL,
  `desdeBodegaId` INTEGER NOT NULL,
  `haciaBodegaId` INTEGER NOT NULL,
  `estado` VARCHAR(191) NOT NULL DEFAULT 'PENDIENTE',
  `responsable` VARCHAR(191) NULL,
  `observaciones` MEDIUMTEXT NULL,
  `aprobadoPor` VARCHAR(191) NULL,
  `aprobadoEn` DATETIME(3) NULL,
  `recibidoEn` DATETIME(3) NULL,
  UNIQUE INDEX `SolicitudTraslado_folio_key` (`folio`),
  INDEX `SolicitudTraslado_ventaId_idx` (`ventaId`),
  INDEX `SolicitudTraslado_desdeBodegaId_idx` (`desdeBodegaId`),
  INDEX `SolicitudTraslado_haciaBodegaId_idx` (`haciaBodegaId`),
  INDEX `SolicitudTraslado_estado_idx` (`estado`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DetalleSolicitudTraslado` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `solicitudId` INTEGER NOT NULL,
  `detalleVentaId` INTEGER NULL,
  `productoId` INTEGER NOT NULL,
  `cantidad` INTEGER NOT NULL,
  INDEX `DetalleSolicitudTraslado_solicitudId_idx` (`solicitudId`),
  INDEX `DetalleSolicitudTraslado_productoId_idx` (`productoId`),
  INDEX `DetalleSolicitudTraslado_detalleVentaId_idx` (`detalleVentaId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ConteoInventario` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `folio` VARCHAR(191) NULL,
  `fecha` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `bodegaId` INTEGER NOT NULL,
  `responsable` VARCHAR(191) NULL,
  `observaciones` MEDIUMTEXT NULL,
  `estado` VARCHAR(191) NOT NULL DEFAULT 'APLICADO',
  UNIQUE INDEX `ConteoInventario_folio_key` (`folio`),
  INDEX `ConteoInventario_bodegaId_idx` (`bodegaId`),
  INDEX `ConteoInventario_fecha_idx` (`fecha`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DetalleConteoInventario` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `conteoId` INTEGER NOT NULL,
  `productoId` INTEGER NOT NULL,
  `stockSistema` INTEGER NOT NULL,
  `stockFisico` INTEGER NOT NULL,
  `diferencia` INTEGER NOT NULL,
  INDEX `DetalleConteoInventario_conteoId_idx` (`conteoId`),
  INDEX `DetalleConteoInventario_productoId_idx` (`productoId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StockMinimoBodegaProducto` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `bodegaId` INTEGER NOT NULL,
  `productoId` INTEGER NOT NULL,
  `minimo` INTEGER NOT NULL DEFAULT 0,
  UNIQUE INDEX `StockMinimoBodegaProducto_bodegaId_productoId_key` (`bodegaId`, `productoId`),
  INDEX `StockMinimoBodegaProducto_productoId_idx` (`productoId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DetalleVenta` ADD CONSTRAINT `DetalleVenta_solicitudTrasladoId_fkey` FOREIGN KEY (`solicitudTrasladoId`) REFERENCES `SolicitudTraslado`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Traslado` ADD CONSTRAINT `Traslado_solicitudTrasladoId_fkey` FOREIGN KEY (`solicitudTrasladoId`) REFERENCES `SolicitudTraslado`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `SolicitudTraslado` ADD CONSTRAINT `SolicitudTraslado_ventaId_fkey` FOREIGN KEY (`ventaId`) REFERENCES `Venta`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `SolicitudTraslado` ADD CONSTRAINT `SolicitudTraslado_desdeBodegaId_fkey` FOREIGN KEY (`desdeBodegaId`) REFERENCES `Bodega`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SolicitudTraslado` ADD CONSTRAINT `SolicitudTraslado_haciaBodegaId_fkey` FOREIGN KEY (`haciaBodegaId`) REFERENCES `Bodega`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `DetalleSolicitudTraslado` ADD CONSTRAINT `DetalleSolicitudTraslado_solicitudId_fkey` FOREIGN KEY (`solicitudId`) REFERENCES `SolicitudTraslado`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `DetalleSolicitudTraslado` ADD CONSTRAINT `DetalleSolicitudTraslado_productoId_fkey` FOREIGN KEY (`productoId`) REFERENCES `Producto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ConteoInventario` ADD CONSTRAINT `ConteoInventario_bodegaId_fkey` FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `DetalleConteoInventario` ADD CONSTRAINT `DetalleConteoInventario_conteoId_fkey` FOREIGN KEY (`conteoId`) REFERENCES `ConteoInventario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `DetalleConteoInventario` ADD CONSTRAINT `DetalleConteoInventario_productoId_fkey` FOREIGN KEY (`productoId`) REFERENCES `Producto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `StockMinimoBodegaProducto` ADD CONSTRAINT `StockMinimoBodegaProducto_bodegaId_fkey` FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `StockMinimoBodegaProducto` ADD CONSTRAINT `StockMinimoBodegaProducto_productoId_fkey` FOREIGN KEY (`productoId`) REFERENCES `Producto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
