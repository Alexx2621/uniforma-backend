-- AlterTable
ALTER TABLE `PedidoProduccion`
  ADD COLUMN `postventaId` INTEGER NULL,
  ADD COLUMN `postventaCobro` VARCHAR(191) NULL DEFAULT 'normal';

-- CreateIndex
CREATE INDEX `PedidoProduccion_postventaId_idx` ON `PedidoProduccion`(`postventaId`);

-- AddForeignKey
ALTER TABLE `PedidoProduccion`
  ADD CONSTRAINT `PedidoProduccion_postventaId_fkey`
  FOREIGN KEY (`postventaId`) REFERENCES `CambioDevolucion`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
