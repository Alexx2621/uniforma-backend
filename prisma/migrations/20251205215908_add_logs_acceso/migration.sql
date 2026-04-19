-- CreateTable
CREATE TABLE `LogAcceso` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuario` VARCHAR(191) NULL,
    `endpoint` VARCHAR(191) NOT NULL,
    `metodo` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `fecha` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resultado` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
