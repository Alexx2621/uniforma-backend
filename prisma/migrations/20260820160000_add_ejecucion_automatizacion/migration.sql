CREATE TABLE `EjecucionAutomatizacion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clave` VARCHAR(80) NOT NULL,
    `estado` VARCHAR(20) NOT NULL DEFAULT 'ejecutando',
    `origen` VARCHAR(30) NOT NULL DEFAULT 'cpanel',
    `iniciadaEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finalizadaEn` DATETIME(3) NULL,
    `duracionMs` INTEGER NULL,
    `resultado` JSON NULL,
    `error` TEXT NULL,

    INDEX `EjecucionAutomatizacion_clave_iniciadaEn_idx`(`clave`, `iniciadaEn`),
    INDEX `EjecucionAutomatizacion_estado_iniciadaEn_idx`(`estado`, `iniciadaEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
