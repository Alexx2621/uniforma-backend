ALTER TABLE `Envio`
  ADD COLUMN `clienteId` INTEGER NULL,
  ADD INDEX `Envio_clienteId_fecha_idx`(`clienteId`, `fecha`);

ALTER TABLE `Envio`
  ADD CONSTRAINT `Envio_clienteId_fkey`
  FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
