CREATE TABLE `CambioDevolucion` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `folio` VARCHAR(191) NOT NULL,
  `tipo` VARCHAR(191) NOT NULL,
  `fecha` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `clienteNombre` VARCHAR(191) NOT NULL,
  `clienteTelefono` VARCHAR(191) NULL,
  `documentoReferencia` VARCHAR(191) NULL,
  `motivo` VARCHAR(191) NOT NULL,
  `estado` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
  `resolucion` VARCHAR(191) NULL,
  `monto` DOUBLE NOT NULL DEFAULT 0,
  `observaciones` MEDIUMTEXT NULL,
  `detalle` JSON NOT NULL,
  `usuarioId` INTEGER NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  UNIQUE INDEX `CambioDevolucion_folio_key`(`folio`),
  INDEX `CambioDevolucion_tipo_fecha_idx`(`tipo`, `fecha`),
  INDEX `CambioDevolucion_estado_fecha_idx`(`estado`, `fecha`),
  INDEX `CambioDevolucion_usuarioId_fecha_idx`(`usuarioId`, `fecha`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CambioDevolucion`
  ADD CONSTRAINT `CambioDevolucion_usuarioId_fkey`
  FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
