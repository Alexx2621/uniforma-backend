CREATE TABLE `ProduccionUnificado` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scope` VARCHAR(191) NOT NULL,
    `firmaContenido` VARCHAR(191) NOT NULL,
    `correlativo` VARCHAR(191) NOT NULL,
    `abreviatura` VARCHAR(191) NOT NULL,
    `numero` INTEGER NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `bodegaId` INTEGER NULL,
    `resumen` JSON NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProduccionUnificado_correlativo_key`(`correlativo`),
    UNIQUE INDEX `ProduccionUnificado_scope_firmaContenido_key`(`scope`, `firmaContenido`),
    INDEX `ProduccionUnificado_scope_creadoEn_idx`(`scope`, `creadoEn`),
    INDEX `ProduccionUnificado_bodegaId_idx`(`bodegaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProduccionUnificado` ADD CONSTRAINT `ProduccionUnificado_bodegaId_fkey`
FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
