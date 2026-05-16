ALTER TABLE `PedidoProduccion`
  ADD COLUMN `clienteCorreo` VARCHAR(191) NULL;

UPDATE `PedidoProduccion` p
LEFT JOIN `Cliente` c ON c.`id` = p.`clienteId`
SET p.`clienteCorreo` = c.`correo`
WHERE p.`clienteCorreo` IS NULL
  AND c.`correo` IS NOT NULL;

CREATE TABLE `PedidoTracking` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `pedidoId` INTEGER NOT NULL,
  `token` VARCHAR(191) NOT NULL,
  `clienteCorreo` VARCHAR(191) NULL,
  `ultimoEstado` VARCHAR(191) NOT NULL DEFAULT 'pedido_ingresado',
  `ultimoEnvioEn` DATETIME(3) NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PedidoTracking_pedidoId_key`(`pedidoId`),
  UNIQUE INDEX `PedidoTracking_token_key`(`token`),
  INDEX `PedidoTracking_clienteCorreo_idx`(`clienteCorreo`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PedidoTrackingEvento` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `trackingId` INTEGER NOT NULL,
  `estado` VARCHAR(191) NOT NULL,
  `titulo` VARCHAR(191) NOT NULL,
  `mensaje` MEDIUMTEXT NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `emailEnviado` BOOLEAN NOT NULL DEFAULT false,

  INDEX `PedidoTrackingEvento_trackingId_creadoEn_idx`(`trackingId`, `creadoEn`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PedidoTracking`
  ADD CONSTRAINT `PedidoTracking_pedidoId_fkey`
  FOREIGN KEY (`pedidoId`) REFERENCES `PedidoProduccion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PedidoTrackingEvento`
  ADD CONSTRAINT `PedidoTrackingEvento_trackingId_fkey`
  FOREIGN KEY (`trackingId`) REFERENCES `PedidoTracking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
