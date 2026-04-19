-- AlterTable
ALTER TABLE `DetallePedidoProduccion` ADD COLUMN `descripcion` VARCHAR(191) NULL DEFAULT '',
    ADD COLUMN `descuento` DOUBLE NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `PagoPedido` ADD COLUMN `porcentajeRecargo` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `recargo` DOUBLE NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `PedidoProduccion` ADD COLUMN `metodoPago` VARCHAR(191) NULL,
    ADD COLUMN `porcentajeRecargo` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `recargo` DOUBLE NOT NULL DEFAULT 0;
