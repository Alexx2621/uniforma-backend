-- CreateTable
CREATE TABLE `HallazgoConsistencia` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chequeo` VARCHAR(191) NOT NULL,
    `entidad` VARCHAR(191) NOT NULL,
    `entidadId` INTEGER NOT NULL,
    `referencia` VARCHAR(191) NULL,
    `severidad` VARCHAR(191) NOT NULL DEFAULT 'alta',
    `diferencia` DOUBLE NULL,
    `diagnostico` MEDIUMTEXT NULL,
    `datos` JSON NOT NULL,
    `estado` VARCHAR(191) NOT NULL DEFAULT 'abierto',
    `detectadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `vistoEn` DATETIME(3) NOT NULL,
    `resueltoEn` DATETIME(3) NULL,
    `resueltoPorId` INTEGER NULL,
    `resolucion` MEDIUMTEXT NULL,

    UNIQUE INDEX `HallazgoConsistencia_chequeo_entidad_entidadId_key`(`chequeo`, `entidad`, `entidadId`),
    INDEX `HallazgoConsistencia_estado_severidad_detectadoEn_idx`(`estado`, `severidad`, `detectadoEn`),
    INDEX `HallazgoConsistencia_chequeo_estado_idx`(`chequeo`, `estado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `HallazgoConsistencia` ADD CONSTRAINT `HallazgoConsistencia_resueltoPorId_fkey` FOREIGN KEY (`resueltoPorId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
