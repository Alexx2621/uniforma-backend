CREATE TABLE `Envio` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `folio` VARCHAR(191) NULL,
  `fecha` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `estado` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
  `destinatarioNombre` VARCHAR(191) NOT NULL,
  `destinatarioTelefono` VARCHAR(191) NULL,
  `direccion` MEDIUMTEXT NOT NULL,
  `municipio` VARCHAR(191) NULL,
  `departamento` VARCHAR(191) NULL,
  `empresaTransporte` VARCHAR(191) NULL,
  `numeroGuia` VARCHAR(191) NULL,
  `costo` DOUBLE NOT NULL DEFAULT 0,
  `metodoPagoEnvio` VARCHAR(191) NULL,
  `observaciones` MEDIUMTEXT NULL,
  `usuarioId` INTEGER NOT NULL,
  `bodegaId` INTEGER NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  UNIQUE INDEX `Envio_folio_key`(`folio`),
  INDEX `Envio_fecha_idx`(`fecha`),
  INDEX `Envio_usuarioId_fecha_idx`(`usuarioId`, `fecha`),
  INDEX `Envio_bodegaId_fecha_idx`(`bodegaId`, `fecha`),
  INDEX `Envio_estado_fecha_idx`(`estado`, `fecha`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EnvioDocumento` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `envioId` INTEGER NOT NULL,
  `tipo` VARCHAR(191) NOT NULL,
  `documentoId` INTEGER NOT NULL,
  `referencia` VARCHAR(191) NULL,
  `titulo` VARCHAR(191) NULL,
  `monto` DOUBLE NOT NULL DEFAULT 0,
  `fecha` DATETIME(3) NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `EnvioDocumento_envioId_tipo_documentoId_key`(`envioId`, `tipo`, `documentoId`),
  INDEX `EnvioDocumento_tipo_documentoId_idx`(`tipo`, `documentoId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Envio`
  ADD CONSTRAINT `Envio_usuarioId_fkey`
  FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Envio`
  ADD CONSTRAINT `Envio_bodegaId_fkey`
  FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `EnvioDocumento`
  ADD CONSTRAINT `EnvioDocumento_envioId_fkey`
  FOREIGN KEY (`envioId`) REFERENCES `Envio`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
