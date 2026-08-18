-- AlterTable
ALTER TABLE `SolicitudTraslado` ADD COLUMN `solicitanteId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `SolicitudTraslado_solicitanteId_idx` ON `SolicitudTraslado`(`solicitanteId`);

-- AddForeignKey
ALTER TABLE `SolicitudTraslado` ADD CONSTRAINT `SolicitudTraslado_solicitanteId_fkey` FOREIGN KEY (`solicitanteId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
