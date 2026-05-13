ALTER TABLE `Usuario`
    ADD COLUMN `whatsappBusinessNumber` VARCHAR(191) NULL,
    ADD COLUMN `whatsappPhoneNumberId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Usuario_whatsappPhoneNumberId_key` ON `Usuario`(`whatsappPhoneNumberId`);

CREATE TABLE `WhatsappMensaje` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vendedorId` INTEGER NOT NULL,
    `numeroVendedor` VARCHAR(191) NULL,
    `phoneNumberId` VARCHAR(191) NULL,
    `remitente` VARCHAR(191) NOT NULL,
    `remitenteNombre` VARCHAR(191) NULL,
    `mensaje` MEDIUMTEXT NULL,
    `externalId` VARCHAR(191) NULL,
    `leido` BOOLEAN NOT NULL DEFAULT false,
    `recibidoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WhatsappMensaje_externalId_key`(`externalId`),
    INDEX `WhatsappMensaje_vendedorId_leido_recibidoEn_idx`(`vendedorId`, `leido`, `recibidoEn`),
    INDEX `WhatsappMensaje_recibidoEn_idx`(`recibidoEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WhatsappMensaje`
    ADD CONSTRAINT `WhatsappMensaje_vendedorId_fkey`
    FOREIGN KEY (`vendedorId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
