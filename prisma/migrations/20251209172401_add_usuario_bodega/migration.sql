-- AlterTable
ALTER TABLE `usuario` ADD COLUMN `bodegaId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `Usuario` ADD CONSTRAINT `Usuario_bodegaId_fkey` FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
