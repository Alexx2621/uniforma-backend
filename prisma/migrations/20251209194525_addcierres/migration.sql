-- AlterTable
ALTER TABLE `Venta` ADD COLUMN `bodegaId` INTEGER NULL,
    ADD COLUMN `vendedor` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `Venta` ADD CONSTRAINT `Venta_bodegaId_fkey` FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
