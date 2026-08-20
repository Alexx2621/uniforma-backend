-- AlterTable
ALTER TABLE `Venta` ADD COLUMN `esVentaEspecial` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `Venta_esVentaEspecial_fecha_idx` ON `Venta`(`esVentaEspecial`, `fecha`);

-- CreateTable
CREATE TABLE `VentaEspecialAutorizacion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `estado` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
    `comentario` MEDIUMTEXT NULL,
    `respuestaComentario` MEDIUMTEXT NULL,
    `payload` JSON NOT NULL,
    `solicitadoPorId` INTEGER NOT NULL,
    `autorizadoPorId` INTEGER NULL,
    `ventaId` INTEGER NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,
    `autorizadoEn` DATETIME(3) NULL,

    INDEX `VentaEspecialAutorizacion_estado_creadoEn_idx`(`estado`, `creadoEn`),
    INDEX `VentaEspecialAutorizacion_solicitadoPorId_creadoEn_idx`(`solicitadoPorId`, `creadoEn`),
    INDEX `VentaEspecialAutorizacion_autorizadoPorId_creadoEn_idx`(`autorizadoPorId`, `creadoEn`),
    INDEX `VentaEspecialAutorizacion_ventaId_idx`(`ventaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `VentaEspecialAutorizacion` ADD CONSTRAINT `VentaEspecialAutorizacion_solicitadoPorId_fkey` FOREIGN KEY (`solicitadoPorId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VentaEspecialAutorizacion` ADD CONSTRAINT `VentaEspecialAutorizacion_autorizadoPorId_fkey` FOREIGN KEY (`autorizadoPorId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VentaEspecialAutorizacion` ADD CONSTRAINT `VentaEspecialAutorizacion_ventaId_fkey` FOREIGN KEY (`ventaId`) REFERENCES `Venta`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
