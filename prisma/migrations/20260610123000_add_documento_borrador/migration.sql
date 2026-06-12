CREATE TABLE `documentoborrador` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tipoDocumento` VARCHAR(191) NOT NULL,
  `estado` VARCHAR(191) NOT NULL DEFAULT 'abierto',
  `titulo` VARCHAR(191) NULL,
  `data` JSON NOT NULL,
  `totalEstimado` DOUBLE NOT NULL DEFAULT 0,
  `usuarioId` INTEGER NOT NULL,
  `bodegaId` INTEGER NULL,
  `clienteId` INTEGER NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `docbor_user_tipo_estado_upd_idx`
  ON `documentoborrador` (`usuarioId`, `tipoDocumento`, `estado`, `actualizadoEn`);

CREATE INDEX `docbor_tipo_estado_upd_idx`
  ON `documentoborrador` (`tipoDocumento`, `estado`, `actualizadoEn`);

CREATE INDEX `docbor_bodega_idx`
  ON `documentoborrador` (`bodegaId`);

CREATE INDEX `docbor_cliente_idx`
  ON `documentoborrador` (`clienteId`);

ALTER TABLE `documentoborrador`
  ADD CONSTRAINT `documentoborrador_usuarioId_fkey`
  FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
