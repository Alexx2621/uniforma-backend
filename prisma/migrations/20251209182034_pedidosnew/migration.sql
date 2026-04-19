-- AlterTable
ALTER TABLE `detallepedidoproduccion` ADD COLUMN `precioUnit` DOUBLE NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `pedidoproduccion` ADD COLUMN `anticipo` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `bodegaId` INTEGER NULL,
    ADD COLUMN `clienteId` INTEGER NULL,
    ADD COLUMN `saldoPendiente` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `totalEstimado` DOUBLE NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `PagoPedido` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pedidoId` INTEGER NOT NULL,
    `monto` DOUBLE NOT NULL,
    `metodo` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(191) NOT NULL DEFAULT 'anticipo',
    `fecha` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PedidoProduccion` ADD CONSTRAINT `PedidoProduccion_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PedidoProduccion` ADD CONSTRAINT `PedidoProduccion_bodegaId_fkey` FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PagoPedido` ADD CONSTRAINT `PagoPedido_pedidoId_fkey` FOREIGN KEY (`pedidoId`) REFERENCES `PedidoProduccion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
