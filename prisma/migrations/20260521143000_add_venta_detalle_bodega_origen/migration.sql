ALTER TABLE `DetalleVenta`
  ADD COLUMN `bodegaId` INTEGER NULL,
  ADD COLUMN `requiereTraslado` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `trasladoEstado` VARCHAR(191) NULL;

CREATE INDEX `DetalleVenta_bodegaId_idx` ON `DetalleVenta`(`bodegaId`);
CREATE INDEX `DetalleVenta_requiereTraslado_trasladoEstado_idx` ON `DetalleVenta`(`requiereTraslado`, `trasladoEstado`);

ALTER TABLE `DetalleVenta` ADD CONSTRAINT `DetalleVenta_bodegaId_fkey` FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;