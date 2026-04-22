CREATE TABLE `ProduccionUnificadoPedido` (
    `produccionUnificadoId` INTEGER NOT NULL,
    `pedidoId` INTEGER NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProduccionUnificadoPedido_pedidoId_idx`(`pedidoId`),
    PRIMARY KEY (`produccionUnificadoId`, `pedidoId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProduccionUnificadoPedido` ADD CONSTRAINT `ProduccionUnificadoPedido_produccionUnificadoId_fkey`
FOREIGN KEY (`produccionUnificadoId`) REFERENCES `ProduccionUnificado`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProduccionUnificadoPedido` ADD CONSTRAINT `ProduccionUnificadoPedido_pedidoId_fkey`
FOREIGN KEY (`pedidoId`) REFERENCES `PedidoProduccion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
