CREATE TABLE `CorrelativoConfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tipo` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `abreviatura` VARCHAR(191) NOT NULL,
    `siguienteNumero` INTEGER NOT NULL DEFAULT 1,
    `bodegaId` INTEGER NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CorrelativoConfig_scope_key`(`scope`),
    INDEX `CorrelativoConfig_tipo_idx`(`tipo`),
    INDEX `CorrelativoConfig_bodegaId_idx`(`bodegaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CorrelativoConfig` ADD CONSTRAINT `CorrelativoConfig_bodegaId_fkey` FOREIGN KEY (`bodegaId`) REFERENCES `Bodega`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
