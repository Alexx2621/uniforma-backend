-- DropForeignKey
ALTER TABLE `mermaproduccion` DROP FOREIGN KEY `MermaProduccion_insumoId_fkey`;

-- DropIndex
DROP INDEX `MermaProduccion_insumoId_fkey` ON `mermaproduccion`;

-- AlterTable
ALTER TABLE `mermaproduccion` MODIFY `insumoId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `MermaProduccion` ADD CONSTRAINT `MermaProduccion_insumoId_fkey` FOREIGN KEY (`insumoId`) REFERENCES `Insumo`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
