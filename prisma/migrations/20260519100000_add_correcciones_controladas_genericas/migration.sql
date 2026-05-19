CREATE TABLE `CorreccionControlada` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `modulo` VARCHAR(191) NOT NULL,
  `entidadTipo` VARCHAR(191) NOT NULL,
  `entidadId` INTEGER NOT NULL,
  `correlativo` VARCHAR(191) NULL,
  `titulo` VARCHAR(191) NULL,
  `campo` VARCHAR(191) NOT NULL,
  `etiqueta` VARCHAR(191) NOT NULL,
  `valorAnterior` JSON NULL,
  `valorNuevo` JSON NULL,
  `motivo` MEDIUMTEXT NOT NULL,
  `dataAnterior` JSON NULL,
  `dataNueva` JSON NULL,
  `usuarioId` INTEGER NOT NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `CorreccionControlada_entidadTipo_entidadId_creadoEn_idx`(`entidadTipo`, `entidadId`, `creadoEn`),
  INDEX `CorreccionControlada_usuarioId_creadoEn_idx`(`usuarioId`, `creadoEn`),
  INDEX `CorreccionControlada_modulo_creadoEn_idx`(`modulo`, `creadoEn`),
  INDEX `CorreccionControlada_correlativo_idx`(`correlativo`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CorreccionControlada`
  ADD CONSTRAINT `CorreccionControlada_usuarioId_fkey`
  FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
