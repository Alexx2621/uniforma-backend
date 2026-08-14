CREATE TABLE `AutorizacionVentaCliente` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `clienteId` INTEGER NOT NULL, `solicitanteId` INTEGER NOT NULL,
  `propietarioId` INTEGER NOT NULL, `ventaId` INTEGER NULL, `estado` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
  `motivo` MEDIUMTEXT NULL, `respuesta` MEDIUMTEXT NULL, `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `resueltoEn` DATETIME(3) NULL, `consumidoEn` DATETIME(3) NULL,
  UNIQUE INDEX `AutorizacionVentaCliente_ventaId_key`(`ventaId`),
  INDEX `AutorizacionVentaCliente_solicitanteId_clienteId_estado_idx`(`solicitanteId`,`clienteId`,`estado`),
  INDEX `AutorizacionVentaCliente_propietarioId_estado_creadoEn_idx`(`propietarioId`,`estado`,`creadoEn`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `AutorizacionVentaCliente` ADD CONSTRAINT `AutorizacionVentaCliente_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT `AutorizacionVentaCliente_solicitanteId_fkey` FOREIGN KEY (`solicitanteId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT `AutorizacionVentaCliente_propietarioId_fkey` FOREIGN KEY (`propietarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT `AutorizacionVentaCliente_ventaId_fkey` FOREIGN KEY (`ventaId`) REFERENCES `Venta`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
