-- CreateTable
CREATE TABLE `ordenmixta` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `folio` VARCHAR(191) NOT NULL,
    `fecha` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `estado` VARCHAR(191) NOT NULL DEFAULT 'generada',
    `clienteId` INTEGER NULL,
    `clienteNombre` VARCHAR(191) NOT NULL,
    `clienteTelefono` VARCHAR(191) NULL,
    `usuarioId` INTEGER NULL,
    `bodegaId` INTEGER NULL,
    `vendedor` VARCHAR(191) NULL,
    `ubicacion` VARCHAR(191) NULL,
    `metodoPago` VARCHAR(191) NOT NULL,
    `referenciaPago` VARCHAR(191) NULL,
    `bancoPago` VARCHAR(191) NULL,
    `subtotalVenta` DOUBLE NOT NULL DEFAULT 0,
    `subtotalPedido` DOUBLE NOT NULL DEFAULT 0,
    `total` DOUBLE NOT NULL DEFAULT 0,
    `anticipoTotal` DOUBLE NOT NULL DEFAULT 0,
    `anticipoVenta` DOUBLE NOT NULL DEFAULT 0,
    `anticipoPedido` DOUBLE NOT NULL DEFAULT 0,
    `saldoTotal` DOUBLE NOT NULL DEFAULT 0,
    `ventaId` INTEGER NULL,
    `pedidoId` INTEGER NULL,
    `observaciones` MEDIUMTEXT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ordenmixta_folio_key`(`folio`),
    INDEX `ordenmixta_fecha_idx`(`fecha`),
    INDEX `ordenmixta_clienteId_idx`(`clienteId`),
    INDEX `ordenmixta_usuarioId_idx`(`usuarioId`),
    INDEX `ordenmixta_bodegaId_idx`(`bodegaId`),
    INDEX `ordenmixta_ventaId_idx`(`ventaId`),
    INDEX `ordenmixta_pedidoId_idx`(`pedidoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ordenmixtadetalle` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ordenMixtaId` INTEGER NOT NULL,
    `productoId` INTEGER NOT NULL,
    `tipoOperacion` VARCHAR(191) NOT NULL,
    `bodegaId` INTEGER NULL,
    `cantidad` INTEGER NOT NULL,
    `precioUnit` DOUBLE NOT NULL,
    `bordado` DOUBLE NOT NULL DEFAULT 0,
    `descuento` DOUBLE NOT NULL DEFAULT 0,
    `estiloEspecial` BOOLEAN NOT NULL DEFAULT false,
    `estiloEspecialMonto` DOUBLE NOT NULL DEFAULT 0,
    `descripcion` MEDIUMTEXT NULL,
    `subtotal` DOUBLE NOT NULL DEFAULT 0,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ordenmixtadetalle_ordenMixtaId_idx`(`ordenMixtaId`),
    INDEX `ordenmixtadetalle_productoId_idx`(`productoId`),
    INDEX `ordenmixtadetalle_bodegaId_idx`(`bodegaId`),
    INDEX `ordenmixtadetalle_tipoOperacion_idx`(`tipoOperacion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ordenmixta` ADD CONSTRAINT `ordenmixta_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ordenmixta` ADD CONSTRAINT `ordenmixta_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ordenmixta` ADD CONSTRAINT `ordenmixta_bodegaId_fkey` FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ordenmixta` ADD CONSTRAINT `ordenmixta_ventaId_fkey` FOREIGN KEY (`ventaId`) REFERENCES `Venta`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ordenmixta` ADD CONSTRAINT `ordenmixta_pedidoId_fkey` FOREIGN KEY (`pedidoId`) REFERENCES `PedidoProduccion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ordenmixtadetalle` ADD CONSTRAINT `ordenmixtadetalle_ordenMixtaId_fkey` FOREIGN KEY (`ordenMixtaId`) REFERENCES `ordenmixta`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ordenmixtadetalle` ADD CONSTRAINT `ordenmixtadetalle_productoId_fkey` FOREIGN KEY (`productoId`) REFERENCES `Producto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ordenmixtadetalle` ADD CONSTRAINT `ordenmixtadetalle_bodegaId_fkey` FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

