CREATE TABLE `MetaMensual` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `scope` VARCHAR(191) NOT NULL,
  `year` INTEGER NOT NULL,
  `month` INTEGER NOT NULL,
  `bodegaId` INTEGER NULL,
  `usuarioId` INTEGER NULL,
  `metaMes` DOUBLE NOT NULL DEFAULT 0,
  `promedioDiario` DOUBLE NOT NULL DEFAULT 0,
  `observaciones` MEDIUMTEXT NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  UNIQUE INDEX `MetaMensual_scope_key`(`scope`),
  INDEX `MetaMensual_year_month_idx`(`year`, `month`),
  INDEX `MetaMensual_bodegaId_idx`(`bodegaId`),
  INDEX `MetaMensual_usuarioId_idx`(`usuarioId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MetaMensual`
  ADD CONSTRAINT `MetaMensual_bodegaId_fkey`
  FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `MetaMensual`
  ADD CONSTRAINT `MetaMensual_usuarioId_fkey`
  FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
