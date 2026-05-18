CREATE TABLE `CorreccionDocumento` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `documentoId` INTEGER NOT NULL,
  `usuarioId` INTEGER NOT NULL,
  `tipoDocumento` VARCHAR(191) NOT NULL,
  `correlativo` VARCHAR(191) NOT NULL,
  `campo` VARCHAR(191) NOT NULL,
  `etiqueta` VARCHAR(191) NOT NULL,
  `valorAnterior` JSON NULL,
  `valorNuevo` JSON NULL,
  `motivo` MEDIUMTEXT NOT NULL,
  `dataAnterior` JSON NOT NULL,
  `dataNueva` JSON NOT NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `CorreccionDocumento_documentoId_creadoEn_idx` ON `CorreccionDocumento`(`documentoId`, `creadoEn`);
CREATE INDEX `CorreccionDocumento_usuarioId_creadoEn_idx` ON `CorreccionDocumento`(`usuarioId`, `creadoEn`);
CREATE INDEX `CorreccionDocumento_tipoDocumento_creadoEn_idx` ON `CorreccionDocumento`(`tipoDocumento`, `creadoEn`);
CREATE INDEX `CorreccionDocumento_correlativo_idx` ON `CorreccionDocumento`(`correlativo`);

ALTER TABLE `CorreccionDocumento`
  ADD CONSTRAINT `CorreccionDocumento_documentoId_fkey`
  FOREIGN KEY (`documentoId`) REFERENCES `DocumentoGenerado`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CorreccionDocumento`
  ADD CONSTRAINT `CorreccionDocumento_usuarioId_fkey`
  FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
