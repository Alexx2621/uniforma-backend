CREATE TABLE `EnvioManifiestoConfig` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `saldoInicial` DOUBLE NOT NULL DEFAULT 0,
  `saldoActual` DOUBLE NOT NULL DEFAULT 0,
  `costoPorLinea` DOUBLE NOT NULL DEFAULT 40,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EnvioManifiesto` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `folio` VARCHAR(191) NULL,
  `fecha` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `saldoInicial` DOUBLE NOT NULL DEFAULT 0,
  `saldoAntes` DOUBLE NOT NULL DEFAULT 0,
  `costoPorLinea` DOUBLE NOT NULL DEFAULT 40,
  `totalLineas` INTEGER NOT NULL DEFAULT 0,
  `totalConsumido` DOUBLE NOT NULL DEFAULT 0,
  `saldoDespues` DOUBLE NOT NULL DEFAULT 0,
  `observaciones` MEDIUMTEXT NULL,
  `usuarioId` INTEGER NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `EnvioManifiesto_folio_key`(`folio`),
  INDEX `EnvioManifiesto_fecha_idx`(`fecha`),
  INDEX `EnvioManifiesto_usuarioId_fecha_idx`(`usuarioId`, `fecha`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EnvioManifiestoDetalle` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `manifiestoId` INTEGER NOT NULL,
  `envioId` INTEGER NULL,
  `orden` INTEGER NOT NULL DEFAULT 0,
  `numeroGuia` VARCHAR(191) NULL,
  `destinatario` VARCHAR(191) NOT NULL,
  `vendedor` VARCHAR(191) NULL,
  `estado` VARCHAR(191) NULL,
  `costo` DOUBLE NOT NULL DEFAULT 0,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `EnvioManifiestoDetalle_manifiestoId_idx`(`manifiestoId`),
  INDEX `EnvioManifiestoDetalle_envioId_idx`(`envioId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `EnvioManifiesto`
  ADD CONSTRAINT `EnvioManifiesto_usuarioId_fkey`
  FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `EnvioManifiestoDetalle`
  ADD CONSTRAINT `EnvioManifiestoDetalle_manifiestoId_fkey`
  FOREIGN KEY (`manifiestoId`) REFERENCES `EnvioManifiesto`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `EnvioManifiestoDetalle`
  ADD CONSTRAINT `EnvioManifiestoDetalle_envioId_fkey`
  FOREIGN KEY (`envioId`) REFERENCES `Envio`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `EnvioManifiestoConfig` (`id`, `saldoInicial`, `saldoActual`, `costoPorLinea`, `actualizadoEn`)
VALUES (1, 0, 0, 40, CURRENT_TIMESTAMP(3));
