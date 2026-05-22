ALTER TABLE `Bodega`
  ADD COLUMN `tipo` VARCHAR(191) NOT NULL DEFAULT 'tienda',
  ADD COLUMN `activa` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `permiteVentas` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `permitePedidos` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `permiteTraslados` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `visibleVendedores` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `requiereAutorizacion` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `ordenPrioridad` INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN `observaciones` MEDIUMTEXT NULL;

CREATE INDEX `Bodega_activa_idx` ON `Bodega`(`activa`);
CREATE INDEX `Bodega_tipo_idx` ON `Bodega`(`tipo`);
CREATE INDEX `Bodega_ordenPrioridad_idx` ON `Bodega`(`ordenPrioridad`);

CREATE TABLE `UsuarioBodega` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `usuarioId` INTEGER NOT NULL,
  `bodegaId` INTEGER NOT NULL,
  `puedeConsultarStock` BOOLEAN NOT NULL DEFAULT true,
  `puedeVender` BOOLEAN NOT NULL DEFAULT true,
  `puedeTrasladar` BOOLEAN NOT NULL DEFAULT false,
  `puedeAjustar` BOOLEAN NOT NULL DEFAULT false,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `UsuarioBodega_usuarioId_bodegaId_key`(`usuarioId`, `bodegaId`),
  INDEX `UsuarioBodega_bodegaId_idx`(`bodegaId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UsuarioBodega` ADD CONSTRAINT `UsuarioBodega_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UsuarioBodega` ADD CONSTRAINT `UsuarioBodega_bodegaId_fkey` FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
