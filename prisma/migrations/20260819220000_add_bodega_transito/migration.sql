-- AlterTable
ALTER TABLE `Bodega` ADD COLUMN `esTransito` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `Bodega` ADD COLUMN `permiteIngresos` BOOLEAN NOT NULL DEFAULT true;
