CREATE TABLE `TelaRollo` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `codigo` VARCHAR(191) NOT NULL,
  `telaId` INTEGER NOT NULL,
  `colorId` INTEGER NULL,
  `bodegaId` INTEGER NULL,
  `proveedor` VARCHAR(191) NULL,
  `lote` VARCHAR(191) NULL,
  `tono` VARCHAR(191) NULL,
  `ancho` DOUBLE NOT NULL DEFAULT 0,
  `unidad` VARCHAR(191) NOT NULL DEFAULT 'metros',
  `cantidadInicial` DOUBLE NOT NULL DEFAULT 0,
  `cantidadDisponible` DOUBLE NOT NULL DEFAULT 0,
  `costoUnitario` DOUBLE NOT NULL DEFAULT 0,
  `ubicacion` VARCHAR(191) NULL,
  `estado` VARCHAR(191) NOT NULL DEFAULT 'disponible',
  `fechaIngreso` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `observaciones` MEDIUMTEXT NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  UNIQUE INDEX `TelaRollo_codigo_key`(`codigo`),
  INDEX `TelaRollo_telaId_idx`(`telaId`),
  INDEX `TelaRollo_colorId_idx`(`colorId`),
  INDEX `TelaRollo_bodegaId_idx`(`bodegaId`),
  INDEX `TelaRollo_estado_idx`(`estado`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MovimientoTela` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `rolloId` INTEGER NOT NULL,
  `tipo` VARCHAR(191) NOT NULL,
  `cantidad` DOUBLE NOT NULL,
  `fecha` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `referencia` VARCHAR(191) NULL,
  `motivo` VARCHAR(191) NULL,
  `observaciones` MEDIUMTEXT NULL,
  `usuarioId` INTEGER NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `MovimientoTela_rolloId_fecha_idx`(`rolloId`, `fecha`),
  INDEX `MovimientoTela_tipo_fecha_idx`(`tipo`, `fecha`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ConsumoTelaProducto` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `productoId` INTEGER NOT NULL,
  `telaId` INTEGER NULL,
  `tallaId` INTEGER NULL,
  `cantidad` DOUBLE NOT NULL DEFAULT 0,
  `unidad` VARCHAR(191) NOT NULL DEFAULT 'metros',
  `mermaPorcentaje` DOUBLE NOT NULL DEFAULT 0,
  `observaciones` MEDIUMTEXT NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  INDEX `ConsumoTelaProducto_productoId_idx`(`productoId`),
  INDEX `ConsumoTelaProducto_telaId_idx`(`telaId`),
  INDEX `ConsumoTelaProducto_tallaId_idx`(`tallaId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TelaRollo` ADD CONSTRAINT `TelaRollo_telaId_fkey` FOREIGN KEY (`telaId`) REFERENCES `Tela`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `TelaRollo` ADD CONSTRAINT `TelaRollo_colorId_fkey` FOREIGN KEY (`colorId`) REFERENCES `Color`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `TelaRollo` ADD CONSTRAINT `TelaRollo_bodegaId_fkey` FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MovimientoTela` ADD CONSTRAINT `MovimientoTela_rolloId_fkey` FOREIGN KEY (`rolloId`) REFERENCES `TelaRollo`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ConsumoTelaProducto` ADD CONSTRAINT `ConsumoTelaProducto_productoId_fkey` FOREIGN KEY (`productoId`) REFERENCES `Producto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ConsumoTelaProducto` ADD CONSTRAINT `ConsumoTelaProducto_telaId_fkey` FOREIGN KEY (`telaId`) REFERENCES `Tela`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ConsumoTelaProducto` ADD CONSTRAINT `ConsumoTelaProducto_tallaId_fkey` FOREIGN KEY (`tallaId`) REFERENCES `Talla`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
