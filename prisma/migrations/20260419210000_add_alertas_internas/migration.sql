CREATE TABLE `AlertaInterna` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuarioId` INTEGER NOT NULL,
    `rolId` INTEGER NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `titulo` VARCHAR(191) NOT NULL,
    `mensaje` MEDIUMTEXT NOT NULL,
    `payload` MEDIUMTEXT NULL,
    `leida` BOOLEAN NOT NULL DEFAULT false,
    `creadaEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leidaEn` DATETIME(3) NULL,

    INDEX `AlertaInterna_usuarioId_leida_creadaEn_idx`(`usuarioId`, `leida`, `creadaEn`),
    INDEX `AlertaInterna_rolId_creadaEn_idx`(`rolId`, `creadaEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AlertaInterna`
    ADD CONSTRAINT `AlertaInterna_usuarioId_fkey`
    FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `AlertaInterna`
    ADD CONSTRAINT `AlertaInterna_rolId_fkey`
    FOREIGN KEY (`rolId`) REFERENCES `Rol`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
