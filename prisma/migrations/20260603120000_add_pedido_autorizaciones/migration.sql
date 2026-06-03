CREATE TABLE `PedidoProduccionAutorizacion` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `estado` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
  `comentario` MEDIUMTEXT NULL,
  `respuestaComentario` MEDIUMTEXT NULL,
  `payload` JSON NOT NULL,
  `solicitadoPorId` INTEGER NOT NULL,
  `autorizadoPorId` INTEGER NULL,
  `pedidoId` INTEGER NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `autorizadoEn` DATETIME(3) NULL,

  INDEX `PedidoProduccionAutorizacion_estado_creadoEn_idx`(`estado`, `creadoEn`),
  INDEX `PedidoProduccionAutorizacion_solicitadoPorId_creadoEn_idx`(`solicitadoPorId`, `creadoEn`),
  INDEX `PedidoProduccionAutorizacion_autorizadoPorId_creadoEn_idx`(`autorizadoPorId`, `creadoEn`),
  INDEX `PedidoProduccionAutorizacion_pedidoId_idx`(`pedidoId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PedidoProduccionAutorizacion`
  ADD CONSTRAINT `PedidoProduccionAutorizacion_solicitadoPorId_fkey`
  FOREIGN KEY (`solicitadoPorId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PedidoProduccionAutorizacion`
  ADD CONSTRAINT `PedidoProduccionAutorizacion_autorizadoPorId_fkey`
  FOREIGN KEY (`autorizadoPorId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PedidoProduccionAutorizacion`
  ADD CONSTRAINT `PedidoProduccionAutorizacion_pedidoId_fkey`
  FOREIGN KEY (`pedidoId`) REFERENCES `PedidoProduccion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
