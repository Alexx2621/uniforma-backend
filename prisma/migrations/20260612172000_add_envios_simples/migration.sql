CREATE TABLE `EnvioSimple` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `folio` VARCHAR(191) NULL,
  `fecha` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `numeroGuia` VARCHAR(191) NOT NULL,
  `destinatarioNombre` VARCHAR(191) NOT NULL,
  `vendedorNombre` VARCHAR(191) NULL,
  `estado` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
  `observaciones` MEDIUMTEXT NULL,
  `usuarioId` INTEGER NOT NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  UNIQUE INDEX `EnvioSimple_folio_key`(`folio`),
  INDEX `EnvioSimple_fecha_idx`(`fecha`),
  INDEX `EnvioSimple_usuarioId_fecha_idx`(`usuarioId`, `fecha`),
  INDEX `EnvioSimple_estado_fecha_idx`(`estado`, `fecha`),
  INDEX `EnvioSimple_numeroGuia_idx`(`numeroGuia`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `EnvioManifiestoDetalle`
  ADD COLUMN `envioSimpleId` INTEGER NULL,
  ADD INDEX `EnvioManifiestoDetalle_envioSimpleId_idx`(`envioSimpleId`);

ALTER TABLE `EnvioSimple`
  ADD CONSTRAINT `EnvioSimple_usuarioId_fkey`
  FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `EnvioManifiestoDetalle`
  ADD CONSTRAINT `EnvioManifiestoDetalle_envioSimpleId_fkey`
  FOREIGN KEY (`envioSimpleId`) REFERENCES `EnvioSimple`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
