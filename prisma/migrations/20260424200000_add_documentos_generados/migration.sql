-- CreateTable
CREATE TABLE `DocumentoGenerado` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tipo` VARCHAR(191) NOT NULL,
    `correlativo` VARCHAR(191) NOT NULL,
    `titulo` VARCHAR(191) NULL,
    `data` JSON NOT NULL,
    `usuarioId` INTEGER NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DocumentoGenerado_correlativo_key`(`correlativo`),
    INDEX `DocumentoGenerado_tipo_creadoEn_idx`(`tipo`, `creadoEn`),
    INDEX `DocumentoGenerado_usuarioId_creadoEn_idx`(`usuarioId`, `creadoEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DocumentoGenerado` ADD CONSTRAINT `DocumentoGenerado_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
