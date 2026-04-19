-- CreateTable
CREATE TABLE `NotificacionConfig` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `emailTo` VARCHAR(191) NULL DEFAULT '',
    `whatsappTo` VARCHAR(191) NULL DEFAULT '',
    `stockThreshold` INTEGER NOT NULL DEFAULT 5,
    `highSaleThreshold` INTEGER NOT NULL DEFAULT 1000,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
